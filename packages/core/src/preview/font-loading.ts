import { analyzePreviewFonts, getPreviewFontWarnings } from './fonts';
import { classifyPreviewFont, rankPreviewFontCandidates } from './font-matching';
import { createWebFontPacks } from './font-packs';
import type {
  PreviewFontAsset, PreviewFontAssetSource,
  PreviewFontLoadingOptions, PreviewFontReference, PreviewFontRefresh, PreviewOptions, PreviewSession
} from './types';

const defaults: PreviewFontLoadingOptions = {};
const services = new WeakMap<Document, WeakMap<PreviewFontLoadingOptions, FontService>>();
const abortError = () => new DOMException('Font loading aborted.', 'AbortError');
const check = (signal: AbortSignal) => { if (signal.aborted) throw abortError(); };
const bounded = (value: number | undefined, fallback: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value!)) : fallback;

function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(abortError()); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

interface RouteHealth { latency?: number; failures: number; retryAt: number }
interface Entry { users: number; controller: AbortController; promise: Promise<FontFace>; face?: FontFace }
interface Lease { asset: PreviewFontAsset; release(): void }

/** Shared per document/options: active-face leases, request deduplication and adaptive routing. */
class FontService {
  private entries = new Map<PreviewFontAsset, Entry>();
  private routes = new Map<string, RouteHealth>();
  private origins = new Map<string, number>();
  readonly assets: readonly PreviewFontAsset[];
  constructor(private document: Document, readonly options: PreviewFontLoadingOptions) {
    this.assets = (options.packs ?? createWebFontPacks()).flatMap(pack => pack.fonts);
  }

  async acquire(asset: PreviewFontAsset, signal: AbortSignal): Promise<Lease> {
    check(signal);
    let entry = this.entries.get(asset);
    if (!entry) {
      const controller = new AbortController();
      entry = { users: 0, controller, promise: undefined! };
      const current = entry;
      current.promise = this.load(asset, controller.signal).then(face => {
        check(controller.signal);
        this.document.fonts.add(face);
        current.face = face;
        return face;
      });
      this.entries.set(asset, entry);
    }
    entry.users++;
    const current = entry;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      signal.removeEventListener('abort', release);
      if (--current.users === 0) {
        current.controller.abort();
        if (current.face) this.document.fonts.delete(current.face);
        if (this.entries.get(asset) === current) this.entries.delete(asset);
      }
    };
    signal.addEventListener('abort', release, { once: true });
    try { await waitFor(current.promise, signal); check(signal); return { asset, release }; }
    catch (error) { release(); throw error; }
  }

  private async load(asset: PreviewFontAsset, signal: AbortSignal): Promise<FontFace> {
    const Constructor = this.document.defaultView?.FontFace ?? globalThis.FontFace;
    if (!Constructor || !this.document.fonts?.add) throw new Error('FontFace API unavailable.');
    const deadline = Date.now() + bounded(this.options.budgetMs, 12000, 10, 60000);
    const attempts = Math.floor(bounded(this.options.maxAttempts, 3, 1, 8));
    if (asset.data) {
      if (asset.data.byteLength > bounded(this.options.maxFontBytes, 16 * 1024 * 1024, 1024, 64 * 1024 * 1024)) throw new Error('Font exceeds size limit.');
      const bytes = asset.data instanceof Uint8Array ? asset.data.slice().buffer : asset.data.slice(0);
      return this.decode(Constructor, asset, bytes, signal, deadline);
    }
    const sources = (asset.sources ?? []).flatMap(source => {
      try {
        const url = new URL(source.url, this.document.baseURI);
        return /^https?:$/i.test(url.protocol) ? [{ ...source, url: url.href }] : [];
      } catch { return []; }
    });
    let used = 0;
    while (used < attempts) {
      check(signal);
      if (!sources.length || Date.now() >= deadline) break;
      const now = Date.now();
      const healthy = sources.filter(source => this.health(source).retryAt <= now)
        .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || this.cost(a) - this.cost(b));
      if (!healthy.length) {
        const wait = Math.min(...sources.map(source => this.health(source).retryAt)) - now;
        if (wait >= deadline - now) break;
        await delay(wait, signal);
        continue;
      }
      const round = used + 1 < attempts ? healthy.slice(0, 2) : healthy.slice(0, 1);
      try {
        return await this.raceRoutes(round, signal, async (source, requestSignal) => {
          used++;
          return this.request(Constructor, asset, source, requestSignal, deadline);
        });
      } catch { check(signal); }
    }
    throw new Error(`Font "${asset.fontFamily}" could not be loaded; local fallbacks remain active.`);
  }

  private raceRoutes(sources: PreviewFontAssetSource[], signal: AbortSignal, request: (source: PreviewFontAssetSource, signal: AbortSignal) => Promise<FontFace>): Promise<FontFace> {
    return new Promise((resolve, reject) => {
      let settled = false, started = 0, failed = 0;
      const routes: Array<{ source: PreviewFontAssetSource; controller: AbortController; started: number }> = [];
      let timer: ReturnType<typeof setTimeout> | undefined;
      const clean = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
      const abort = () => {
        if (settled) return;
        settled = true; clean(); routes.forEach(route => route.controller.abort()); reject(abortError());
      };
      const start = () => {
        if (settled || started >= sources.length) return;
        const source = sources[started++], controller = new AbortController();
        const route = { source, controller, started: Date.now() }; routes.push(route);
        request(source, controller.signal).then(face => {
          if (settled) return;
          settled = true; clean();
          for (const other of routes) if (other !== route) {
            if (!other.controller.signal.aborted) {
              // A cancelled slow route supplies a latency lower bound, not a failure.
              const health = this.health(other.source);
              health.latency = Math.max(health.latency ?? 0, Date.now() - other.started);
              this.origins.set(new URL(other.source.url).origin, health.latency);
            }
            other.controller.abort();
          }
          resolve(face);
        }, error => {
          if (settled) return;
          failed++;
          if (started < sources.length) { clearTimeout(timer); start(); }
          else if (failed === started) { settled = true; clean(); reject(error); }
        });
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      start();
      if (sources.length > 1) timer = setTimeout(start, bounded(this.options.hedgeDelayMs, 200, 0, 5000));
    });
  }

  private async request(Constructor: typeof FontFace, asset: PreviewFontAsset, source: PreviewFontAssetSource, signal: AbortSignal, deadline: number): Promise<FontFace> {
    const started = Date.now();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, Math.min(deadline - started, bounded(this.options.timeoutMs, 4000, 10, 30000)));
    let retryAfter = 0;
    try {
      const response = await waitFor(fetch(source.url, {
        signal: controller.signal, mode: 'cors', credentials: source.credentials ?? 'omit', headers: source.headers,
        cache: 'force-cache', referrerPolicy: 'no-referrer'
      }), controller.signal);
      if (!response.ok) {
        const value = response.headers.get('Retry-After');
        if (value) retryAfter = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Math.max(0, Date.parse(value) - Date.now());
        if ([401, 403, 404, 410].includes(response.status)) retryAfter = Math.max(retryAfter || 0, 300000);
        void response.body?.cancel().catch(() => {});
        throw new Error('Font source returned an error.');
      }
      const limit = bounded(this.options.maxFontBytes, 16 * 1024 * 1024, 1024, 64 * 1024 * 1024);
      if (Number(response.headers.get('Content-Length')) > limit) { void response.body?.cancel().catch(() => {}); throw new Error('Font exceeds size limit.'); }
      const bytes = await waitFor(readBounded(response, limit, controller.signal), controller.signal);
      const face = await this.decode(Constructor, asset, bytes, controller.signal, deadline);
      check(signal);
      const health = this.health(source);
      const elapsed = Math.max(1, Date.now() - started);
      health.latency = health.latency === undefined ? elapsed : health.latency * 0.7 + elapsed * 0.3;
      this.origins.set(new URL(source.url).origin, health.latency);
      health.failures = 0; health.retryAt = 0;
      return face;
    } catch (error) {
      check(signal);
      const health = this.health(source);
      const base = bounded(this.options.backoffMs, 500, 1, 30000);
      const cap = bounded(this.options.maxBackoffMs, 30000, base, 300000);
      health.failures = Math.min(health.failures + 1, 10);
      health.retryAt = Date.now() + Math.max(Number.isFinite(retryAfter) ? retryAfter : 0,
        Math.min(cap, base * 2 ** (health.failures - 1)) * (0.75 + Math.random() * 0.5));
      throw error;
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); controller.abort(); }
  }

  private async decode(Constructor: typeof FontFace, asset: PreviewFontAsset, bytes: ArrayBuffer, signal: AbortSignal, deadline: number) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, Math.max(0, Math.min(deadline - Date.now(), bounded(this.options.timeoutMs, 4000, 10, 30000))));
    try {
      check(signal);
      const face = new Constructor(asset.fontFamily, bytes, { display: 'swap', ...asset.descriptors });
      await waitFor(face.load(), controller.signal);
      check(signal);
      return face;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }

  private health(source: PreviewFontAssetSource) {
    // Health is keyed by endpoint, credentials and headers; secrets never leave this object.
    const key = JSON.stringify([source.url, source.credentials, source.headers]);
    let health = this.routes.get(key);
    if (!health) this.routes.set(key, health = { failures: 0, retryAt: 0 });
    return health;
  }
  private cost(source: PreviewFontAssetSource) {
    const sameOrigin = new URL(source.url).origin === new URL(this.document.baseURI).origin;
    const health = this.health(source);
    return (health.latency ?? this.origins.get(new URL(source.url).origin) ?? (sameOrigin ? 500 : 1500)) + health.failures * 5000;
  }
}

async function readBounded(response: Response, limit: number, signal: AbortSignal): Promise<ArrayBuffer> {
  if (!response.body?.getReader) {
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > limit) throw new Error('Invalid font response size.');
    return bytes;
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('Font exceeds size limit.');
      chunks.push(value);
    }
    if (!length) throw new Error('Empty font response.');
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes.buffer;
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}

/** Start after first render. The owning driver must destroy this binding on teardown. */
export function bindPreviewFontLoading(session: PreviewSession, document: Document, options: PreviewOptions): { reset(signal?: AbortSignal, sourceFormat?: string): void; destroy(): void } {
  const configuration = options.fontLoading === true ? defaults : options.fontLoading || undefined;
  if (!configuration || !session.refreshFonts) return { reset() {}, destroy() {} };
  let byOptions = services.get(document);
  if (!byOptions) services.set(document, byOptions = new WeakMap());
  let service = byOptions.get(configuration);
  if (!service) byOptions.set(configuration, service = new FontService(document, configuration));
  let controller = new AbortController(), destroyed = false, running = false, queued = false;
  const seen = new Set<string>(), leases: Lease[] = [], loaded: PreviewFontAsset[] = [];
  let removeAbort: (() => void) | undefined;
  let sourceFormat: string | undefined;
  const reset = (signal?: AbortSignal, format?: string) => {
    sourceFormat = format;
    removeAbort?.(); removeAbort = undefined;
    controller.abort(); controller = new AbortController();
    leases.splice(0).forEach(lease => lease.release()); loaded.length = 0; seen.clear();
    running = false;
    if (signal) {
      const abort = () => { controller.abort(); leases.splice(0).forEach(lease => lease.release()); };
      signal.addEventListener('abort', abort, { once: true });
      removeAbort = () => signal.removeEventListener('abort', abort);
      if (signal.aborted) abort();
    }
  };
  const schedule = () => {
    if (queued || destroyed) return;
    queued = true;
    queueMicrotask(() => { queued = false; void run(); });
  };
  const run = async () => {
    const state = session.getState();
    if (destroyed || running || controller.signal.aborted || state.loading || state.error) return;
    const signal = controller.signal;
    const references: readonly PreviewFontReference[] = session.getFontReferences?.() ?? (state.fonts ?? []).map(font => ({ ...font, traits: font.classification }));
    const keyOf = (ref: PreviewFontReference) => JSON.stringify([ref.fontFamily, ref.fontFile, ref.traits, ref.resolvedFontFamily, ref.fontStyle]);
    const pending = references.filter(ref => {
      const key = keyOf(ref);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    if (!pending.length) return;
    running = true;
    const warnings: string[] = [], resolved = new Map<PreviewFontReference, PreviewFontReference>();
    let index = 0;
    const worker = async () => {
      while (index < pending.length && !signal.aborted) {
        const ref = pending[index++];
        if (!(ref.fontFamily || ref.resolvedFontFamily) || ref.embedded || (ref.browserUnsupported || /\.shx$/i.test(ref.fontFile ?? '')) && !ref.resolvedFontFamily) continue;
        let assets = service!.assets;
        let request = ref;
        try {
          let choice;
          try { choice = options.fontResolver?.({ family: state.family, sourceFormat, fontFamily: ref.fontFamily, fontFile: ref.fontFile, styleName: ref.styleName, fontStyle: ref.fontStyle }); }
          catch { warnings.push(`Font resolver failed for "${ref.fontFamily}"; pack and local fallbacks remain active.`); }
          if (choice) {
            const family = typeof choice === 'string' ? choice : choice.fontFamily;
            if (family) request = { ...ref, resolvedFontFamily: family, source: 'application' };
            if (typeof choice !== 'string') { assets = [...choice.assets ?? [], ...assets]; warnings.push(...choice.warnings ?? []); }
          }
          const local = analyzePreviewFonts([request], document, { substitute: true }).fonts[0];
          const installed = loaded.filter(asset => asset.fontFamily === (local?.resolvedFontFamily ?? request.resolvedFontFamily ?? request.fontFamily));
          const classification = classifyPreviewFont(request.fontFamily ?? '', request.traits);
          const weight = classification.weight ?? 400;
          const hasFace = installed.some(asset => {
            const weights = (asset.descriptors?.weight ?? String(asset.traits?.weight ?? 400)).split(/\s+/).map(Number);
            return weight >= weights[0] && weight <= (weights[1] ?? weights[0]) && (asset.descriptors?.style ?? 'normal').startsWith(ref.fontStyle ?? 'normal');
          });
          const needsFace = installed.length > 0 && !hasFace;
          if (hasFace || !needsFace && (local?.status === 'available' || request.source === 'application' && local?.status === 'substituted')) {
            if (request.resolvedFontFamily && request.resolvedFontFamily !== ref.resolvedFontFamily) resolved.set(ref, request);
            continue;
          }
          const desired = request.resolvedFontFamily ?? request.fontFamily!;
          assets = assets.filter(asset => (asset.descriptors?.style ?? 'normal') === (ref.fontStyle ?? 'normal'));
          const exact = assets.filter(asset => asset.fontFamily.toLowerCase() === desired.toLowerCase())
            .sort((a, b) => Math.abs((a.traits?.weight ?? 400) - (ref.traits?.weight ?? 400)) - Math.abs((b.traits?.weight ?? 400) - (ref.traits?.weight ?? 400)));
          if (!exact.length && !request.resolvedFontFamily && ['serif', 'monospace', 'style', 'script'].every(key => classification[key as keyof typeof classification] === undefined)) continue;
          const matches = rankPreviewFontCandidates({ ...request, fontFamily: desired }, assets);
          const selected = [...exact, ...matches.map(match => match.candidate as PreviewFontAsset).filter(asset => !exact.includes(asset))];
          if (request.resolvedFontFamily) selected.splice(0, selected.length, ...exact);
          if (!selected.length) continue;
          if (!needsFace && configuration.preferLocal !== false && local?.status === 'substituted' && !exact.length) {
            const localCandidate = { fontFamily: local.resolvedFontFamily! };
            const ranked = rankPreviewFontCandidates(ref, [localCandidate, ...selected]);
            if (ranked[0]?.candidate === localCandidate) continue;
          }
          // Try the best compatible family, then a second pack if every mirror fails.
          const families = new Set<string>();
          for (const asset of selected.filter(asset => {
            const family = asset.fontFamily.toLowerCase();
            if (families.has(family)) return false;
            families.add(family); return true;
          }).slice(0, 2)) {
            try {
              const lease = await service!.acquire(asset, signal);
              if (signal.aborted) { lease.release(); break; }
              leases.push(lease); loaded.push(asset);
              resolved.set(ref, { ...request, resolvedFontFamily: asset.fontFamily, source: request.source === 'application' ? 'application' : 'fallback' });
              break;
            } catch {
              if (signal.aborted) break;
            }
          }
          if (!signal.aborted && !resolved.has(ref)) warnings.push(`Font "${desired}" could not be loaded; local fallback fonts remain active.`);
        } catch {
          if (!signal.aborted) warnings.push(`Font "${ref.fontFamily}" could not be loaded; local fallback fonts remain active.`);
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.floor(bounded(configuration.concurrency, 3, 1, 8)) }, worker));
      if (signal.aborted || destroyed) return;
      const next = references.map(ref => resolved.get(ref) ?? ref);
      for (const ref of resolved.values()) seen.add(keyOf(ref));
      if (resolved.size || warnings.length) await session.refreshFonts!({ references: next, loaded: [...loaded], warnings: [...new Set(warnings)], relayout: resolved.size > 0 });
    } catch { /* A font refresh must not turn a readable preview into an error. */ }
    finally { if (!signal.aborted) { running = false; schedule(); } }
  };
  const unsubscribes = [session.on('rendered', schedule), session.on('statechange', schedule)];
  return { reset, destroy() { destroyed = true; unsubscribes.forEach(unsubscribe => unsubscribe()); reset(); } };
}

/** A loaded FontFace is stronger provenance than a canvas-width heuristic. */
export function analyzeLoadedPreviewFonts(update: PreviewFontRefresh, document: Document) {
  const analysis = analyzePreviewFonts(update.references, document, { substitute: true, candidates: update.loaded });
  for (const font of analysis.fonts) {
    const family = font.resolvedFontFamily ?? font.fontFamily;
    if (!update.loaded.some(candidate => candidate.fontFamily.toLowerCase() === family?.toLowerCase())) continue;
    font.status = font.resolvedFontFamily && font.resolvedFontFamily.toLowerCase() !== font.fontFamily?.toLowerCase() ? 'substituted' : 'available';
    font.source = update.references.find(ref => ref.fontFamily === font.fontFamily)?.source ?? 'application';
    if (font.status === 'substituted' && font.source === 'fallback') {
      const reference = update.references.find(ref => ref.fontFamily === font.fontFamily);
      const match = reference && rankPreviewFontCandidates(reference, update.loaded.filter(candidate => candidate.fontFamily === family))[0];
      font.substitutionReason = ['webfont', ...match?.reasons ?? []].join(', ');
      font.matchScore = match?.score; font.coverage = match?.coverage ?? 'unknown';
    }
  }
  analysis.warnings = [...new Set([...getPreviewFontWarnings(analysis.fonts), ...update.warnings])];
  return analysis;
}
