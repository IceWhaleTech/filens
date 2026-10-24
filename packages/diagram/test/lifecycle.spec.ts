import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { createDiagramPreviewDriver, loadVsdxDiagram } from '../src';
import { createDrawioFixture, createVisioPage, legacyVdxFixture } from './fixtures/diagrams.mjs';

const context = (source: Blob | Uint8Array, format: string, signal?: AbortSignal) =>
  ({ descriptor: { source, extension: format }, signal });
async function bytes(format: string) {
  if (format !== 'vsdx') return new TextEncoder().encode(format === 'vdx' ? legacyVdxFixture : createDrawioFixture(2));
  const zip = new JSZip(); zip.file('visio/pages/page1.xml', createVisioPage(2));
  return zip.generateAsync({ type: 'uint8array' });
}
function delayed(format: string) {
  let resolve!: (value: any) => void, reject!: (error: Error) => void;
  const promise = new Promise((finish, fail) => { resolve = finish; reject = fail; });
  const source = new Blob([]), read = vi.fn(() => promise);
  Object.defineProperty(source, format === 'vsdx' ? 'arrayBuffer' : 'text', { value: read });
  return { source, read, release: (bytes?: Uint8Array) => resolve(format === 'vsdx'
    ? bytes?.slice().buffer ?? new ArrayBuffer(0) : bytes ? new TextDecoder().decode(bytes) : '<invalid/>'), reject };
}

describe('diagram session lifecycle', () => {
  it.each(['drawio', 'dio', 'vdx', 'vsdx'])('discards stale %s successes and errors after switching files', async format => {
    const host = document.createElement('div'), session = createDiagramPreviewDriver().createSession(host);
    const rendered = vi.fn(), error = vi.fn(); session.on('rendered', rendered); session.on('error', error);
    const source = await bytes(format), old = delayed(format);
    const pending = session.load(old.source, context(old.source, format)).then(() => 'done', error => error.name);
    await session.load(source, context(source, format));
    const html = host.innerHTML, state = session.getState();
    old.release(source); expect(await pending).toBe('done');
    expect(host.innerHTML).toBe(html); expect(session.getState()).toEqual(state);
    const failed = delayed(format);
    const failure = session.load(failed.source, context(failed.source, format)).then(() => 'done', error => error.name);
    await session.load(source, context(source, format));
    failed.reject(new Error('Old read failed')); expect(await failure).toBe('done');
    expect(host.innerHTML).toBe(html); expect(session.getState()).toEqual(state);
    expect(rendered).toHaveBeenCalledTimes(2); expect(error).not.toHaveBeenCalled(); session.destroy();
  });

  it.each(['drawio', 'dio', 'vdx', 'vsdx'])('cancels %s before parsing and releases previous content', async format => {
    const host = document.createElement('div'), session = createDiagramPreviewDriver().createSession(host);
    const source = await bytes(format); await session.load(source, context(source, format));
    const rendered = vi.fn(), error = vi.fn(); session.on('rendered', rendered); session.on('error', error);
    const controller = new AbortController(), old = delayed(format);
    const pending = session.load(old.source, context(old.source, format, controller.signal)).then(() => 'done', error => error.name);
    expect(host.querySelector('svg')).toBeNull(); controller.abort();
    expect(session.getState().loading).toBe(false);
    old.release(); expect(await pending).toBe('AbortError');
    expect(session.getState()).toMatchObject({ error: null, pageCount: 0, selectedElementId: undefined });
    expect(rendered).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    const cancelled = delayed(format);
    await expect(session.load(cancelled.source, context(cancelled.source, format, controller.signal)))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled.read).not.toHaveBeenCalled(); session.destroy();
  });

  it.each(['drawio', 'dio', 'vdx', 'vsdx'])('discards pending %s reads and releases selection and listeners on destroy', async format => {
    const host = document.createElement('div'), session = createDiagramPreviewDriver().createSession(host);
    const source = await bytes(format); await session.load(source, context(source, format));
    host.querySelector('.diagramv-node')!.dispatchEvent(new MouseEvent('click'));
    const changed = vi.fn(), rendered = vi.fn(), error = vi.fn();
    session.on('statechange', changed); session.on('rendered', rendered); session.on('error', error);
    const old = delayed(format);
    const pending = session.load(old.source, context(old.source, format)).then(() => 'done', error => error.name);
    changed.mockClear(); session.destroy(); old.release(source); expect(await pending).toBe('done');
    expect(host.childElementCount).toBe(0);
    expect(session.getState()).toMatchObject({ loading: false, pageCount: 0, selectedElementId: undefined });
    session.setScale?.(1.5);
    expect(changed).not.toHaveBeenCalled(); expect(rendered).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });

  it('clears old pages and reports current-file errors', async () => {
    const host = document.createElement('div'), session = createDiagramPreviewDriver().createSession(host);
    const source = await bytes('drawio'); await session.load(source, context(source, 'drawio'));
    const error = vi.fn(); session.on('error', error);
    const invalid = new TextEncoder().encode('<invalid/>');
    await expect(session.load(invalid, context(invalid, 'drawio'))).rejects.toThrow('geometry');
    expect(host.querySelector('svg')).toBeNull(); expect(session.getState().pageCount).toBe(0);
    expect(error).toHaveBeenCalledTimes(1); session.destroy();
  });

  it.each(['unzip', 'manifest', 'relationships', 'page'])('checks VSDX cancellation after %s', async boundary => {
    const zip = new JSZip();
    zip.file('visio/pages/pages.xml', '<Pages xmlns:r="urn:relationships"><Page ID="1"><Rel r:id="r1"/></Page><Page ID="2"><Rel r:id="r2"/></Page></Pages>');
    zip.file('visio/pages/_rels/pages.xml.rels', '<Relationships><Relationship Id="r1" Target="page1.xml"/><Relationship Id="r2" Target="page2.xml"/></Relationships>');
    zip.file('visio/pages/page1.xml', createVisioPage(1)); zip.file('visio/pages/page2.xml', createVisioPage(1));
    const archive = await JSZip.loadAsync(await zip.generateAsync({ type: 'arraybuffer' }));
    const paths = ['visio/pages/pages.xml', 'visio/pages/_rels/pages.xml.rels', 'visio/pages/page1.xml', 'visio/pages/page2.xml'];
    const reads = paths.map(path => vi.spyOn(archive.file(path)!, 'async'));
    const controller = new AbortController(), load = vi.spyOn(JSZip, 'loadAsync');
    try {
      controller.abort();
      await expect(loadVsdxDiagram(new ArrayBuffer(0), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
      expect(load).not.toHaveBeenCalled();
      const current = new AbortController();
      load.mockImplementationOnce(async () => { if (boundary === 'unzip') current.abort(); return archive; });
      const index = ['manifest', 'relationships', 'page'].indexOf(boundary);
      if (index >= 0) reads[index]!.mockImplementationOnce(async () => { current.abort(); return '<invalid/>'; });
      await expect(loadVsdxDiagram(new ArrayBuffer(0), { signal: current.signal })).rejects.toMatchObject({ name: 'AbortError' });
      for (let next = index + 1; next < reads.length; next++) expect(reads[next]).not.toHaveBeenCalled();
    } finally { reads.forEach(read => read.mockRestore()); load.mockRestore(); }
  });
});
