import { normalizeExtension } from './formats';
import type {
  ImagePreviewState,
  MediaPreviewState,
  PreviewDriver,
  PreviewEventMap,
  PreviewEventName,
  PreviewFamily,
  PreviewFitMode,
  PreviewItemState,
  PreviewLoadContext,
  PreviewOptions,
  PreviewSession,
  PreviewSource,
  TextPreviewState
} from './types';

type PreviewListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};

const IMAGE_FORMATS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'apng', 'ico', 'svg', 'bmp']);
const HTML_FORMATS = new Set(['html', 'htm', 'shtml', 'xhtml', 'xht', 'xhtm']);
const VIDEO_FORMATS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv', 'avi', 'mpeg', 'mpg', '3gp']);
const AUDIO_FORMATS = new Set(['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'oga', 'opus']);
const TEXT_FORMATS = new Set(['txt', 'log', 'text']);
const CODE_FORMATS = new Set([
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'mts',
  'cts',
  'vue',
  'css',
  'scss',
  'sass',
  'less',
  'json',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'rst',
  'rest',
  'adoc',
  'asciidoc',
  'asc',
  'tex',
  'latex',
  'ltx',
  'sty',
  'cls',
  'properties',
  'env',
  'conf',
  'config',
  'cfg',
  'cnf',
  'c',
  'cpp',
  'cc',
  'cxx',
  'h',
  'hpp',
  'hh',
  'hxx',
  'cs',
  'go',
  'java',
  'kt',
  'kts',
  'lua',
  'php',
  'py',
  'rb',
  'rs',
  'sh',
  'bat',
  'cmd',
  'ps1',
  'sql',
  'swift',
  'jsonc',
  'json5',
  'gql',
  'graphql',
  'proto',
  'diff',
  'patch',
  'gitignore',
  'dockerignore',
  'editorconfig',
  'r',
  'dart',
  'scala',
  'groovy',
  'gradle',
  'pl',
  'ex',
  'erl',
  'fs',
  'fsi',
  'fsx',
  'vb',
  'clj',
  'hs',
  'jl',
  'zig',
  'm',
  'matlab',
  'svelte',
  'astro',
  'mdx',
  'tf',
  'tfvars',
  'hcl',
  'rego',
  'bicep',
  'prisma',
  'dockerfile',
  'cmake',
  'make',
  'mk',
  'bash',
  'zsh',
  'fish',
  'csproj',
  'vbproj',
  'fsproj',
  'props',
  'targets',
  'sln',
  'cshtml',
  'razor',
  'mustache',
  'hbs',
  'liquid',
  'jinja',
  'twig',
  'ejs',
  'erb',
  'haml',
  'slim',
  'mermaid',
  'mmd',
  'puml',
  'avsc',
  'sol',
  'move',
  'nim',
  'cr',
  'ml',
  'mli',
  'elm',
  'rkt',
  'lisp',
  'scm',
  'asm',
  's',
  'cu',
  'cuh',
  'd',
  'pas',
  'adb',
  'ads',
  'cob',
  'cbl',
  'f90',
  'f95',
  'vhd',
  'vhdl',
  'sv',
  'svh',
  'ino',
  'glsl',
  'vert',
  'frag',
  'wgsl',
  'hlsl',
  'rmd',
  'qmd',
  'bib',
  'nix',
  'cue',
  'dhall',
  'org',
  'wiki',
  'mediawiki',
  'textile',
  'pod',
  'man',
  'roff',
  'nfo',
  'npmrc',
  'yarnrc',
  'gitattributes',
  'gitmodules',
  'md',
  'markdown',
  'mkd',
  'mkdn',
  'mdown'
]);

// ponytail: lightweight highlighting is capped; use a worker-backed grammar engine for huge files or compiler-grade parsing.
const CODE_HIGHLIGHT_LIMIT = 200_000;
const HASH_COMMENT_LANGUAGES = new Set(
  'bash cmake conf config cfg cnf dockerfile env fish hcl make mk nix npmrc pl powershell py qmd r rb rego sh toml yaml yarnrc zsh'.split(
    ' '
  )
);
const DASH_COMMENT_LANGUAGES = new Set('ada haskell hs lua sql'.split(' '));
const SEMICOLON_COMMENT_LANGUAGES = new Set('asm clj ini lisp scm'.split(' '));
const NO_SLASH_COMMENT_LANGUAGES = new Set(
  'asciidoc markdown mdx restructuredtext roff textile wiki xml'.split(' ')
);
const CODE_KEYWORDS = new Set(
  `abstract and as async await begin break by case catch class const continue crate create def default defer delete do
  drop elif else end enum ensure except export extends false final finally fn for foreach from fun func get global go
  group having if implements import in include inner insert instanceof interface into is join lambda left let limit loop
  map match mod move mut namespace new nil nonlocal not null of on operator or order outer override package pass private
  protected public raise readonly ref return right select self set static struct super switch table then this throw trait
  true try type typeof undefined union unsafe update use using values var view virtual void when where while with yield`
    .trim()
    .split(/\s+/)
);
const CODE_LITERALS = new Set('false infinity nan nil none null true undefined'.split(' '));
const CODE_TYPES = new Set(
  'any bigint bool boolean byte char date datetime decimal double float int integer long never number object short string symbol unknown void'.split(
    ' '
  )
);
const CODE_STRING_PATTERN = /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/.source;
const CODE_NUMBER_PATTERN =
  /\b(?:0[xX][\dA-Fa-f](?:_?[\dA-Fa-f])*|0[bB][01](?:_?[01])*|0[oO][0-7](?:_?[0-7])*|\d(?:_?\d)*(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?)n?\b/.source;
const CODE_IDENTIFIER_PATTERN = /[A-Za-z_$][\w$-]*/.source;
const CODE_OPERATOR_PATTERN = /[\[\](){}.,;:+*\/%=&|!<>?~^-]+/.source;

type CodeTokenKind =
  | 'comment'
  | 'keyword'
  | 'literal'
  | 'string'
  | 'number'
  | 'property'
  | 'tag'
  | 'function'
  | 'type'
  | 'operator';

abstract class NativePreviewSession<TState extends PreviewItemState> implements PreviewSession<TState> {
  protected readonly listeners: PreviewListenerMap = {
    loading: new Set(),
    rendered: new Set(),
    error: new Set(),
    statechange: new Set(),
    warnings: new Set()
  };
  protected readonly root: HTMLDivElement;
  protected createdUrl: string | null = null;

  constructor(protected readonly host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'pptxv-native-preview';
    this.host.replaceChildren(this.root);
  }

  abstract load(source: PreviewSource, context: PreviewLoadContext): Promise<void>;
  abstract getState(): TState;

  async fullscreen(): Promise<void> {
    await toggleFullscreen(this.root);
  }

  destroy(): void {
    this.revokeCreatedUrl();
    this.root.replaceChildren();
    if (this.root.parentElement === this.host) {
      this.host.replaceChildren();
    }
  }

  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void {
    this.listeners[event].add(handler as never);
    return () => {
      this.listeners[event].delete(handler as never);
    };
  }

  protected emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]): void {
    for (const handler of this.listeners[event]) {
      handler(payload as never);
    }
  }

  protected setLoading(state: TState): void {
    state.loading = true;
    state.error = null;
    this.emit('loading', state);
    this.emit('statechange', state);
  }

  protected setError(state: TState, error: unknown): never {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    state.loading = false;
    state.error = normalizedError.message;
    this.emit('error', normalizedError);
    this.emit('statechange', state);
    throw normalizedError;
  }

  protected sourceToUrl(source: PreviewSource, contentType?: string): string {
    this.revokeCreatedUrl();
    if (typeof source === 'string') {
      return source;
    }

    const blob =
      source instanceof Blob
        ? source
        : new Blob([toBlobPart(source)], contentType ? { type: contentType } : undefined);
    this.createdUrl = URL.createObjectURL(blob);
    return this.createdUrl;
  }

  protected revokeCreatedUrl(): void {
    if (this.createdUrl) {
      URL.revokeObjectURL(this.createdUrl);
      this.createdUrl = null;
    }
  }
}

export class ImagePreviewSession extends NativePreviewSession<ImagePreviewState> {
  private state: ImagePreviewState;
  private scale: number;
  private fitMode: PreviewFitMode;
  private image: HTMLImageElement | null = null;
  private panDrag: { pointerId: number; x: number; y: number } | null = null;

  constructor(host: HTMLElement, options: PreviewOptions = {}) {
    super(host);
    this.scale = options.initialScale ?? 1;
    this.fitMode = options.fit ?? 'contain';
    this.state = {
      loading: false,
      error: null,
      family: 'image',
      warnings: [],
      capabilities: {
        zoom: true,
        fit: true,
        pan: true,
        rotate: true,
        fullscreen: true,
        download: true
      },
      scale: this.scale,
      rotation: 0,
      panX: 0,
      panY: 0
    };
    this.root.addEventListener('pointerdown', this.handlePointerDown);
    this.root.addEventListener('mousedown', this.handleMouseDown);
  }

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    this.state.family = context.route?.family === 'panorama' ? 'panorama' : 'image';
    this.state.title = context.descriptor.name;
    this.setLoading(this.state);

    try {
      const image = document.createElement('img');
      image.className = 'pptxv-native-image';
      image.alt = context.descriptor.name ?? 'Image preview';
      image.decoding = 'async';
      image.draggable = false;
      image.src = this.sourceToUrl(source, context.descriptor.contentType);
      image.addEventListener('dragstart', (event) => event.preventDefault());
      image.addEventListener('load', () => {
        this.state.naturalWidth = image.naturalWidth || undefined;
        this.state.naturalHeight = image.naturalHeight || undefined;
        this.state.loading = false;
        this.state.error = null;
        this.applyImageStyle();
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
      });
      image.addEventListener('error', () => {
        const error = new Error('Failed to load image preview.');
        this.state.loading = false;
        this.state.error = error.message;
        this.emit('error', error);
        this.emit('statechange', this.state);
      });
      this.image = image;
      this.root.className = 'pptxv-native-preview pptxv-native-preview--image';
      this.root.replaceChildren(image);
      this.applyImageStyle();
    } catch (error) {
      this.setError(this.state, error);
    }
  }

  destroy(): void {
    this.stopPanDrag();
    this.root.removeEventListener('pointerdown', this.handlePointerDown);
    this.root.removeEventListener('mousedown', this.handleMouseDown);
    super.destroy();
  }

  getState(): ImagePreviewState {
    return this.state;
  }

  setScale(scale: number): void {
    this.scale = Math.max(0.05, scale);
    this.state.scale = this.scale;
    this.fitMode = 'none';
    this.applyImageStyle();
    this.emit('statechange', this.state);
  }

  fit(mode: PreviewFitMode = 'contain'): void {
    this.fitMode = mode;
    if (mode !== 'none') {
      this.state.scale = 1;
      this.scale = 1;
      this.state.panX = 0;
      this.state.panY = 0;
    }
    this.applyImageStyle();
    this.emit('statechange', this.state);
  }

  rotate(degrees = 90): void {
    this.state.rotation = normalizeRotation(this.state.rotation + degrees);
    this.applyImageStyle();
    this.emit('statechange', this.state);
  }

  pan(deltaX: number, deltaY: number): void {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      return;
    }
    this.state.panX = Number((this.state.panX + deltaX).toFixed(3));
    this.state.panY = Number((this.state.panY + deltaY).toFixed(3));
    this.fitMode = 'none';
    this.applyImageStyle();
    this.emit('statechange', this.state);
  }

  private applyImageStyle(): void {
    if (!this.image) {
      return;
    }

    this.image.style.transform = `translate(${this.state.panX}px, ${this.state.panY}px) rotate(${this.state.rotation}deg) scale(${this.state.scale})`;
    this.image.style.maxWidth = this.fitMode === 'none' ? 'none' : this.fitMode === 'height' ? 'none' : '100%';
    this.image.style.maxHeight = this.fitMode === 'none' ? 'none' : this.fitMode === 'width' ? 'none' : '100%';
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.image || this.state.loading || this.panDrag) {
      return;
    }

    this.startPanDrag(event.pointerId, event.clientX, event.clientY);
    this.root.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || !this.image || this.state.loading || this.panDrag) {
      return;
    }

    this.startPanDrag(-1, event.clientX, event.clientY);
    event.preventDefault();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.movePanDrag(event.pointerId, event.clientX, event.clientY);
  };

  private readonly handlePointerEnd = (event: PointerEvent): void => {
    if (!this.panDrag || event.pointerId !== this.panDrag.pointerId) {
      return;
    }

    this.stopPanDrag(event.pointerId);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.panDrag || this.panDrag.pointerId !== -1) {
      return;
    }

    this.movePanDrag(-1, event.clientX, event.clientY);
  };

  private readonly handleMouseEnd = (): void => {
    if (!this.panDrag || this.panDrag.pointerId !== -1) {
      return;
    }

    this.stopPanDrag();
  };

  private startPanDrag(pointerId: number, x: number, y: number): void {
    this.panDrag = {
      pointerId,
      x,
      y
    };
    this.root.classList.add('is-panning');
    if (pointerId === -1) {
      window.addEventListener('mousemove', this.handleMouseMove);
      window.addEventListener('mouseup', this.handleMouseEnd);
      return;
    }
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerEnd);
    window.addEventListener('pointercancel', this.handlePointerEnd);
  }

  private movePanDrag(pointerId: number, x: number, y: number): void {
    if (!this.panDrag || this.panDrag.pointerId !== pointerId) {
      return;
    }

    const deltaX = x - this.panDrag.x;
    const deltaY = y - this.panDrag.y;
    this.panDrag = {
      pointerId,
      x,
      y
    };
    this.pan(deltaX, deltaY);
  }

  private stopPanDrag(pointerId?: number): void {
    if (pointerId != null) {
      this.root.releasePointerCapture?.(pointerId);
    }
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerEnd);
    window.removeEventListener('pointercancel', this.handlePointerEnd);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseEnd);
    this.root.classList.remove('is-panning');
    this.panDrag = null;
  }
}

export class TextPreviewSession extends NativePreviewSession<TextPreviewState> {
  private state: TextPreviewState = {
    loading: false,
    error: null,
    family: 'text',
    warnings: [],
    capabilities: {
      search: true,
      wordWrap: true,
      lineNumbers: true,
      codeHighlight: false,
      download: true
    },
    wrap: true,
    encoding: 'utf-8'
  };

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    const isCode = context.route?.family === 'code';
    this.state = {
      ...this.state,
      loading: false,
      error: null,
      title: context.descriptor.name,
      family: isCode ? 'code' : 'text',
      warnings: [],
      capabilities: {
        ...this.state.capabilities,
        codeHighlight: isCode
      },
      language: isCode ? inferLanguage(context.route?.sourceFormat) : undefined,
      wrap: !isCode
    };
    this.setLoading(this.state);

    try {
      const text = await readTextSource(source, context);
      const lineCount = text ? text.split(/\r\n|\r|\n/).length : 0;
      const shell = document.createElement('div');
      shell.className = 'pptxv-native-text-shell';
      shell.dataset.family = this.state.family;
      shell.dataset.wrap = String(this.state.wrap);

      const body = document.createElement('div');
      body.className = 'pptxv-native-text-body';

      const gutter = document.createElement('div');
      gutter.className = 'pptxv-native-text-gutter';
      gutter.setAttribute('aria-hidden', 'true');
      gutter.replaceChildren(...renderLineNumbers(lineCount));

      const pre = document.createElement('pre');
      pre.className = 'pptxv-native-text';
      pre.dataset.family = this.state.family;
      pre.dataset.wrap = String(this.state.wrap);
      if (this.state.language) {
        pre.dataset.language = this.state.language;
      }
      if (isCode && text.length <= CODE_HIGHLIGHT_LIMIT) {
        renderHighlightedCode(pre, text, this.state.language);
        pre.dataset.highlighted = 'true';
      } else {
        pre.textContent = text;
        pre.dataset.highlighted = 'false';
      }
      body.replaceChildren(gutter, pre);
      shell.replaceChildren(body);

      this.state.loading = false;
      this.state.error = null;
      this.state.lineCount = lineCount;
      this.root.className = 'pptxv-native-preview pptxv-native-preview--text';
      this.root.replaceChildren(shell);
      this.emit('rendered', this.state);
      this.emit('statechange', this.state);
    } catch (error) {
      this.setError(this.state, error);
    }
  }

  getState(): TextPreviewState {
    return this.state;
  }
}

export class HtmlPreviewSession extends NativePreviewSession<PreviewItemState> {
  private state: PreviewItemState = {
    loading: false,
    error: null,
    family: 'html',
    warnings: [],
    capabilities: {
      search: false,
      print: true,
      download: true,
      fullscreen: true
    }
  };

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    this.state = {
      ...this.state,
      loading: false,
      error: null,
      title: context.descriptor.name,
      warnings: []
    };
    this.setLoading(this.state);

    try {
      const frame = document.createElement('iframe');
      frame.className = 'pptxv-native-html-frame';
      frame.title = context.descriptor.name ?? 'HTML preview';
      frame.setAttribute('sandbox', 'allow-same-origin allow-popups');
      frame.referrerPolicy = 'no-referrer';
      frame.src = this.sourceToHtmlUrl(source, context);
      frame.addEventListener('load', () => {
        this.state.loading = false;
        this.state.error = null;
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
      });
      frame.addEventListener('error', () => {
        const error = new Error('Failed to load HTML preview.');
        this.state.loading = false;
        this.state.error = error.message;
        this.emit('error', error);
        this.emit('statechange', this.state);
      });
      this.root.className = 'pptxv-native-preview pptxv-native-preview--html';
      this.root.replaceChildren(frame);
    } catch (error) {
      this.setError(this.state, error);
    }
  }

  getState(): PreviewItemState {
    return this.state;
  }

  private sourceToHtmlUrl(source: PreviewSource, context: PreviewLoadContext): string {
    if (typeof source === 'string' && !isInlineHtml(source)) {
      return source;
    }

    this.revokeCreatedUrl();
    const blob =
      source instanceof Blob
        ? source
        : new Blob([sourceToHtmlBlobPart(source)], {
            type: context.descriptor.contentType ?? 'text/html'
          });
    this.createdUrl = URL.createObjectURL(blob);
    return this.createdUrl;
  }
}

export class MediaPreviewSession extends NativePreviewSession<MediaPreviewState> {
  private state: MediaPreviewState = {
    loading: false,
    error: null,
    family: 'video',
    warnings: [],
    capabilities: {
      playback: true,
      timeline: true,
      volume: true,
      fullscreen: true,
      subtitles: true,
      download: true
    },
    currentTime: 0,
    paused: true,
    muted: false,
    volume: 1
  };
  private media: HTMLMediaElement | null = null;
  private coverUrl: string | null = null;

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    const family = resolveMediaFamily(context);
    this.state = {
      ...this.state,
      loading: false,
      error: null,
      title: context.descriptor.name,
      family,
      capabilities: {
        ...this.state.capabilities,
        fullscreen: family !== 'audio',
        subtitles: family !== 'audio'
      },
      duration: undefined,
      currentTime: 0,
      paused: true
    };
    this.setLoading(this.state);

    try {
      this.revokeCoverUrl();
      const media = document.createElement(family === 'audio' ? 'audio' : 'video');
      media.className = `pptxv-native-media pptxv-native-media--${family === 'audio' ? 'audio' : 'video'}`;
      media.controls = true;
      media.preload = 'metadata';
      media.src = this.sourceToUrl(source, context.descriptor.contentType);
      media.addEventListener('loadedmetadata', () => {
        this.syncMediaState(media);
        this.state.loading = false;
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
      });
      media.addEventListener('timeupdate', () => {
        this.syncMediaState(media);
        this.emit('statechange', this.state);
      });
      media.addEventListener('play', () => {
        this.syncMediaState(media);
        this.emit('statechange', this.state);
      });
      media.addEventListener('pause', () => {
        this.syncMediaState(media);
        this.emit('statechange', this.state);
      });
      media.addEventListener('volumechange', () => {
        this.syncMediaState(media);
        this.emit('statechange', this.state);
      });
      media.addEventListener('error', () => {
        const error = new Error('Failed to load media preview.');
        this.state.loading = false;
        this.state.error = error.message;
        this.emit('error', error);
        this.emit('statechange', this.state);
      });

      this.media = media;
      this.root.className = `pptxv-native-preview pptxv-native-preview--${family === 'audio' ? 'audio' : 'video'}`;
      if (family === 'audio') {
        const cover = await extractAudioCover(source);
        if (cover) {
          const img = document.createElement('img');
          img.className = 'pptxv-native-audio-cover';
          img.alt = context.descriptor.name ? `${context.descriptor.name} cover` : 'Audio cover art';
          const blob = new Blob([toBlobPart(cover.bytes)], { type: cover.mimeType });
          this.coverUrl = URL.createObjectURL(blob);
          img.src = this.coverUrl;
          this.root.replaceChildren(img, media);
        } else {
          this.root.replaceChildren(media);
        }
      } else {
        this.root.replaceChildren(media);
      }
    } catch (error) {
      this.setError(this.state, error);
    }
  }

  destroy(): void {
    this.revokeCoverUrl();
    super.destroy();
  }

  getState(): MediaPreviewState {
    return this.state;
  }

  private syncMediaState(media: HTMLMediaElement): void {
    this.state.duration = Number.isFinite(media.duration) ? media.duration : undefined;
    this.state.currentTime = media.currentTime || 0;
    this.state.paused = media.paused;
    this.state.muted = media.muted;
    this.state.volume = media.volume;
    this.state.error = null;
  }

  private revokeCoverUrl(): void {
    if (this.coverUrl) {
      URL.revokeObjectURL(this.coverUrl);
      this.coverUrl = null;
    }
  }
}

export function createImagePreviewDriver(): PreviewDriver<ImagePreviewState> {
  return {
    id: 'image',
    family: 'image',
    supports: (format) => IMAGE_FORMATS.has(normalizeExtension(format)),
    createSession: (host, options) => new ImagePreviewSession(host, options)
  };
}

export function createTextPreviewDriver(): PreviewDriver<TextPreviewState> {
  return {
    id: 'text',
    family: 'text',
    supports: (format) => TEXT_FORMATS.has(normalizeExtension(format)) || CODE_FORMATS.has(normalizeExtension(format)),
    createSession: (host) => new TextPreviewSession(host)
  };
}

export function createMediaPreviewDriver(): PreviewDriver<MediaPreviewState> {
  return {
    id: 'media',
    family: 'video',
    supports: (format) => VIDEO_FORMATS.has(normalizeExtension(format)) || AUDIO_FORMATS.has(normalizeExtension(format)),
    createSession: (host) => new MediaPreviewSession(host)
  };
}

export function createHtmlPreviewDriver(): PreviewDriver<PreviewItemState> {
  return {
    id: 'html',
    family: 'html',
    supports: (format) => HTML_FORMATS.has(normalizeExtension(format)),
    createSession: (host) => new HtmlPreviewSession(host)
  };
}

export function createDefaultNativePreviewDrivers(): PreviewDriver[] {
  return [createImagePreviewDriver(), createTextPreviewDriver(), createMediaPreviewDriver(), createHtmlPreviewDriver()];
}

async function readTextSource(source: PreviewSource, context: PreviewLoadContext): Promise<string> {
  if (typeof source === 'string') {
    if (isDataUrl(source)) {
      return readDataUrl(source);
    }
    const response = await fetch(source, { signal: context.signal });
    if (!response.ok) {
      throw new Error(`Failed to load text preview source: ${response.status} ${response.statusText}`.trim());
    }
    return response.text();
  }

  if (ArrayBuffer.isView(source)) {
    return new TextDecoder().decode(toUint8Array(source));
  }
  if (source instanceof ArrayBuffer) {
    return new TextDecoder().decode(source);
  }
  if (source instanceof Blob) {
    return source.text();
  }
  return String(source);
}

function readDataUrl(source: string): string {
  const commaIndex = source.indexOf(',');
  if (commaIndex < 0) {
    return source;
  }
  const meta = source.slice(0, commaIndex).toLowerCase();
  const payload = source.slice(commaIndex + 1);
  if (meta.endsWith(';base64')) {
    return new TextDecoder().decode(Uint8Array.from(atob(payload), (char) => char.charCodeAt(0)));
  }
  return decodeURIComponent(payload);
}

function renderLineNumbers(lineCount: number): HTMLSpanElement[] {
  return Array.from({ length: Math.max(0, lineCount) }, (_, index) => {
    const line = document.createElement('span');
    line.textContent = String(index + 1);
    return line;
  });
}

function sourceToHtmlBlobPart(source: PreviewSource): BlobPart {
  if (typeof source === 'string') {
    return source;
  }
  if (ArrayBuffer.isView(source)) {
    return toBlobPart(source);
  }
  if (source instanceof ArrayBuffer) {
    return source;
  }
  return source;
}

function toBlobPart(source: Exclude<PreviewSource, string | Blob>): BlobPart {
  if (ArrayBuffer.isView(source)) {
    const bytes = toUint8Array(source);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer as ArrayBuffer;
  }
  return source;
}

function toUint8Array(source: ArrayBufferView): Uint8Array {
  return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
}

async function extractAudioCover(source: PreviewSource): Promise<{ mimeType: string; bytes: Uint8Array } | null> {
  const bytes = await sourceToMaybeUint8Array(source);
  if (!bytes) {
    return null;
  }
  return extractMp3Id3v2Cover(bytes);
}

async function sourceToMaybeUint8Array(source: PreviewSource): Promise<Uint8Array | null> {
  if (typeof source === 'string') {
    return null;
  }
  if (source instanceof Blob) {
    const head = source.slice(0, Math.min(source.size, 512 * 1024));
    return new Uint8Array(await head.arrayBuffer());
  }
  if (ArrayBuffer.isView(source)) {
    const copy = new Uint8Array(source.byteLength);
    copy.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
    return copy;
  }
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }
  return null;
}

function extractMp3Id3v2Cover(bytes: Uint8Array): { mimeType: string; bytes: Uint8Array } | null {
  if (bytes.length < 10) {
    return null;
  }
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return null;
  }

  const major = bytes[3] ?? 0;
  const tagSize = readSynchsafeInt(bytes[6] ?? 0, bytes[7] ?? 0, bytes[8] ?? 0, bytes[9] ?? 0);
  if (!Number.isFinite(tagSize) || tagSize <= 0) {
    return null;
  }

  const tagStart = 10;
  const tagEnd = Math.min(bytes.length, tagStart + tagSize);
  let cursor = tagStart;
  while (cursor + 10 <= tagEnd) {
    const frameId = readAscii(bytes, cursor, cursor + 4);
    if (!frameId || frameId === '\u0000\u0000\u0000\u0000') {
      break;
    }

    const frameSize =
      major === 4
        ? readSynchsafeInt(bytes[cursor + 4] ?? 0, bytes[cursor + 5] ?? 0, bytes[cursor + 6] ?? 0, bytes[cursor + 7] ?? 0)
        : readUint32be(bytes[cursor + 4] ?? 0, bytes[cursor + 5] ?? 0, bytes[cursor + 6] ?? 0, bytes[cursor + 7] ?? 0);

    cursor += 10;
    if (!Number.isFinite(frameSize) || frameSize <= 0 || cursor + frameSize > tagEnd) {
      break;
    }

    if (frameId === 'APIC') {
      const payload = bytes.subarray(cursor, cursor + frameSize);
      const cover = parseId3ApicFrame(payload);
      if (cover) {
        return cover;
      }
    }

    cursor += frameSize;
  }

  return null;
}

function parseId3ApicFrame(payload: Uint8Array): { mimeType: string; bytes: Uint8Array } | null {
  if (!payload.length) {
    return null;
  }

  const encoding = payload[0] ?? 0;
  let offset = 1;
  const mimeRead = readNullTerminatedAscii(payload, offset);
  if (!mimeRead) {
    return null;
  }
  const mimeType = mimeRead.value || 'image/jpeg';
  offset = mimeRead.nextOffset;

  if (offset >= payload.length) {
    return null;
  }

  offset += 1; // picture type

  const descriptionRead =
    encoding === 1 || encoding === 2
      ? readNullTerminatedUtf16(payload, offset)
      : readNullTerminatedAscii(payload, offset);
  offset = descriptionRead?.nextOffset ?? offset;

  if (offset >= payload.length) {
    return null;
  }

  const imageBytes = payload.subarray(offset);
  if (!imageBytes.length) {
    return null;
  }

  return {
    mimeType,
    bytes: imageBytes
  };
}

function readSynchsafeInt(b0: number, b1: number, b2: number, b3: number): number {
  return ((b0 & 0x7f) << 21) | ((b1 & 0x7f) << 14) | ((b2 & 0x7f) << 7) | (b3 & 0x7f);
}

function readUint32be(b0: number, b1: number, b2: number, b3: number): number {
  return (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;
}

function readAscii(bytes: Uint8Array, start: number, end: number): string {
  const slice = bytes.subarray(start, Math.min(end, bytes.length));
  let out = '';
  for (const value of slice) {
    out += String.fromCharCode(value);
  }
  return out;
}

function readNullTerminatedAscii(bytes: Uint8Array, start: number): { value: string; nextOffset: number } | null {
  let end = start;
  while (end < bytes.length && bytes[end] !== 0) {
    end += 1;
  }
  if (end >= bytes.length) {
    return null;
  }
  return {
    value: readAscii(bytes, start, end),
    nextOffset: end + 1
  };
}

function readNullTerminatedUtf16(bytes: Uint8Array, start: number): { value: string; nextOffset: number } | null {
  // Best-effort: look for two consecutive zero bytes to terminate.
  let end = start;
  while (end + 1 < bytes.length) {
    if (bytes[end] === 0 && bytes[end + 1] === 0) {
      const payload = bytes.subarray(start, end);
      let text = '';
      try {
        const hasBom =
          payload.length >= 2 &&
          ((payload[0] === 0xff && payload[1] === 0xfe) || (payload[0] === 0xfe && payload[1] === 0xff));
        text = new TextDecoder(hasBom ? 'utf-16' : 'utf-16le').decode(payload);
      } catch {
        text = '';
      }
      return {
        value: text,
        nextOffset: end + 2
      };
    }
    end += 2;
  }
  return null;
}

function isDataUrl(source: string): boolean {
  return source.trimStart().toLowerCase().startsWith('data:');
}

function isInlineHtml(source: string): boolean {
  const trimmed = source.trimStart().toLowerCase();
  return trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html') || trimmed.startsWith('data:text/html');
}

function resolveMediaFamily(context: PreviewLoadContext): MediaPreviewState['family'] {
  if (
    context.route?.family === 'audio' ||
    context.route?.family === 'video' ||
    context.route?.family === 'panorama-video'
  ) {
    return context.route.family;
  }

  const format = normalizeExtension(context.descriptor.extension ?? context.route?.sourceFormat);
  if (AUDIO_FORMATS.has(format)) {
    return 'audio';
  }
  return 'video';
}

function inferLanguage(format: string | undefined): string | undefined {
  const normalized = normalizeExtension(format);
  if (!normalized) {
    return undefined;
  }
  const aliases: Record<string, string> = {
    adoc: 'asciidoc',
    asc: 'asciidoc',
    ads: 'ada',
    cjs: 'javascript',
    cbl: 'cobol',
    cc: 'cpp',
    cmd: 'batch',
    cls: 'tex',
    cts: 'typescript',
    cnf: 'conf',
    csproj: 'xml',
    cshtml: 'cshtml',
    cuh: 'cuda',
    cxx: 'cpp',
    frag: 'glsl',
    fsproj: 'xml',
    fsi: 'fsharp',
    fsx: 'fsharp',
    h: 'c',
    hh: 'cpp',
    hpp: 'cpp',
    hxx: 'cpp',
    kts: 'kt',
    latex: 'tex',
    ltx: 'tex',
    man: 'roff',
    mdown: 'markdown',
    m: 'matlab',
    mediawiki: 'wiki',
    mkd: 'markdown',
    mkdn: 'markdown',
    mli: 'ocaml',
    mjs: 'javascript',
    mts: 'typescript',
    npmrc: 'ini',
    props: 'xml',
    ps1: 'powershell',
    qmd: 'markdown',
    rmd: 'markdown',
    s: 'asm',
    targets: 'xml',
    svh: 'systemverilog',
    vert: 'glsl',
    vhd: 'vhdl',
    yarnrc: 'ini',
    yml: 'yaml',
    md: 'markdown',
    markdown: 'markdown',
    sln: 'text',
    rest: 'restructuredtext',
    rst: 'restructuredtext',
    sty: 'tex',
    vbproj: 'xml'
  };
  return aliases[normalized] ?? normalized;
}

function renderHighlightedCode(pre: HTMLPreElement, source: string, language: string | undefined): void {
  const pattern = createCodeTokenPattern(language);
  const fragment = document.createDocumentFragment();
  let cursor = 0;

  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? cursor;
    if (index > cursor) {
      fragment.append(document.createTextNode(source.slice(cursor, index)));
    }

    const value = match[0];
    const kind = classifyCodeToken(match.groups, source, index, value);
    if (kind) {
      const token = document.createElement('span');
      token.className = `pptxv-token pptxv-token--${kind}`;
      token.textContent = value;
      fragment.append(token);
    } else {
      fragment.append(document.createTextNode(value));
    }
    cursor = index + value.length;
  }

  if (cursor < source.length) {
    fragment.append(document.createTextNode(source.slice(cursor)));
  }
  pre.replaceChildren(fragment);
}

function createCodeTokenPattern(language: string | undefined): RegExp {
  const comments = ['\\/\\*[\\s\\S]*?\\*\\/', '<!--[\\s\\S]*?-->'];
  if (HASH_COMMENT_LANGUAGES.has(language ?? '')) {
    comments.push('#[^\\r\\n]*');
  }
  if (DASH_COMMENT_LANGUAGES.has(language ?? '')) {
    comments.push('--[^\\r\\n]*');
  }
  if (SEMICOLON_COMMENT_LANGUAGES.has(language ?? '')) {
    comments.push(';[^\\r\\n]*');
  }
  if (!NO_SLASH_COMMENT_LANGUAGES.has(language ?? '') && !DASH_COMMENT_LANGUAGES.has(language ?? '')) {
    comments.push('\\/\\/[^\\r\\n]*');
  }

  return new RegExp(
    `(?<comment>${comments.join('|')})|(?<string>${CODE_STRING_PATTERN})|(?<number>${CODE_NUMBER_PATTERN})|(?<identifier>${CODE_IDENTIFIER_PATTERN})|(?<operator>${CODE_OPERATOR_PATTERN})`,
    'g'
  );
}

function classifyCodeToken(
  groups: Record<string, string> | undefined,
  source: string,
  index: number,
  value: string
): CodeTokenKind | undefined {
  if (groups?.comment) return 'comment';
  if (groups?.string) return 'string';
  if (groups?.number) return 'number';
  if (groups?.operator) return 'operator';
  if (!groups?.identifier) return undefined;

  const normalized = value.toLowerCase();
  if (CODE_LITERALS.has(normalized)) return 'literal';
  if (CODE_KEYWORDS.has(normalized)) return 'keyword';
  if (CODE_TYPES.has(normalized) || /^[A-Z][A-Za-z0-9_$]*$/.test(value)) return 'type';

  const previous = previousNonWhitespace(source, index - 1);
  const next = nextNonWhitespace(source, index + value.length);
  if (source[index - 1] === '<' || (source[index - 2] === '<' && source[index - 1] === '/')) return 'tag';
  if (next === '(') return 'function';
  if (previous === '.' || next === ':') return 'property';
  return undefined;
}

function previousNonWhitespace(source: string, index: number): string | undefined {
  while (index >= 0 && /\s/.test(source[index])) index -= 1;
  return source[index];
}

function nextNonWhitespace(source: string, index: number): string | undefined {
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return source[index];
}

function normalizeRotation(degrees: number): number {
  const normalized = degrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

async function toggleFullscreen(element: HTMLElement): Promise<void> {
  const fullscreenElement = document.fullscreenElement;
  if (fullscreenElement === element && document.exitFullscreen) {
    await document.exitFullscreen();
    return;
  }
  if (!fullscreenElement && element.requestFullscreen) {
    await element.requestFullscreen();
  }
}
