import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { createModel3dPreviewDriver } from '../src';
import type { PreviewLoadContext, PreviewSource } from '@filens/core';

const mock = vi.hoisted(() => ({ parse: vi.fn(), renderers: [] as any[] }));
vi.mock('three', async () => ({ ...await vi.importActual<typeof import('three')>('three'), WebGLRenderer: class {
  domElement = document.createElement('canvas'); setPixelRatio = vi.fn(); setClearColor = vi.fn(); setSize = vi.fn(); render = vi.fn(); dispose = vi.fn();
  constructor() { mock.renderers.push(this); }
} }));
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({ GLTFLoader: class { parseAsync = mock.parse; } }));
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const stl = (triangles = 1) => new TextEncoder().encode(`solid model\n${'facet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\n'.repeat(triangles)}endsolid model`);
const context = (source: PreviewSource, name = 'model.stl', signal?: AbortSignal): PreviewLoadContext => ({ descriptor: { source, name, extension: name.split('.').pop() }, signal });
const sessions: ReturnType<ReturnType<typeof createModel3dPreviewDriver>['createSession']>[] = [];
const setup = () => { const host = document.createElement('div'); document.body.append(host); const session = createModel3dPreviewDriver().createSession(host); sessions.push(session); return { host, session }; };
const objectFixture = () => {
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  const texture = new Texture(), material = new MeshStandardMaterial({ map: texture, normalMap: texture });
  const object = new Group(), child = new Group(); child.add(new Mesh(geometry, material), new Mesh(geometry, material)); object.add(child);
  child.userData.previewObjectUrls = ['blob:child'];
  const spies = [vi.spyOn(geometry,'dispose'),vi.spyOn(material,'dispose'),vi.spyOn(texture,'dispose')];
  return { object, spies };
};
beforeEach(() => {
  mock.renderers.length = 0; mock.parse.mockReset().mockResolvedValue({ scene: new Group() });
  vi.stubGlobal('requestAnimationFrame',vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame',vi.fn());
  vi.stubGlobal('ResizeObserver',class { observe() {} disconnect() {} });
  vi.stubGlobal('URL',class extends URL { static revokeObjectURL = vi.fn(); });
});
afterEach(() => { sessions.splice(0).forEach(session => session.destroy()); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe('3D asynchronous loading and GPU resource lifetime', () => {
  it('does not parse or replace the current model after an old Blob read resolves', async () => {
    const { host, session } = setup(), old = deferred<ArrayBuffer>(), source = new Blob();
    Object.defineProperty(source,'arrayBuffer',{value:() => old.promise});
    const first = session.load(source,context(source,'old.stl'));
    const current = stl(); await session.load(current,context(current,'current.stl'));
    old.resolve(stl(2).buffer as ArrayBuffer); await first;
    expect(session.getState()).toMatchObject({title:'current.stl',error:null,metadata:{triangleCount:1}});
    expect(host.querySelectorAll('canvas')).toHaveLength(1); expect(mock.renderers).toHaveLength(1);
  });

  it('discards an obsolete read error instead of replacing current state', async () => {
    const { session } = setup(), old = deferred<ArrayBuffer>(), source = new Blob(), error = vi.fn();
    Object.defineProperty(source,'arrayBuffer',{value:() => old.promise}); session.on('error',error);
    const first = session.load(source,context(source,'old.stl')).catch(() => {});
    await session.load(stl(),context(stl(),'current.stl')); old.reject(new Error('Old failure')); await first;
    expect(error).not.toHaveBeenCalled(); expect(session.getState()).toMatchObject({title:'current.stl',error:null});
  });

  it('cancels an obsolete source fetch using an internal signal', async () => {
    const { session } = setup(), response = deferred<Response>(), fetch = vi.fn(() => response.promise); vi.stubGlobal('fetch',fetch);
    const first = session.load('/old.stl',context('/old.stl'));
    const signal = (fetch.mock.calls[0] as any)[1]?.signal;
    await session.load(stl(),context(stl())); expect(signal).toBeInstanceOf(AbortSignal); expect(signal.aborted).toBe(true);
    response.resolve(new Response(stl(2))); await first;
    expect(session.getState()).toMatchObject({metadata:{triangleCount:1}});
  });

  it('rejects a pre-aborted source before reading bytes or creating a renderer', async () => {
    const { session } = setup(), source = new Blob(), controller = new AbortController(), read = vi.fn(async () => stl().buffer);
    Object.defineProperty(source,'arrayBuffer',{value:read}); controller.abort();
    await expect(session.load(source,context(source,'abort.stl',controller.signal))).rejects.toMatchObject({name:'AbortError'});
    expect(read).not.toHaveBeenCalled(); expect(mock.renderers).toHaveLength(0); expect(session.getState()).toMatchObject({loading:false,error:null});
  });

  it.each(['replace','destroy','abort'] as const)('disposes a GLB object that resolves after %s without mounting it', async action => {
    const { host, session } = setup(), result = deferred<any>(), controller = new AbortController(), { object, spies } = objectFixture();
    mock.parse.mockImplementationOnce(() => result.promise);
    const errors = vi.fn(), rendered = vi.fn(); session.on('error',errors); session.on('rendered',rendered);
    const source = new Uint8Array([1]); const first = session.load(source,context(source,'old.glb',controller.signal));
    await vi.waitFor(() => expect(mock.parse).toHaveBeenCalledTimes(1));
    if(action==='replace') await session.load(stl(),context(stl(),'current.stl'));
    else if(action==='destroy') session.destroy(); else controller.abort();
    const settled = first.catch(error => { expect(action).toBe('abort'); expect(error.name).toBe('AbortError'); });
    result.resolve({scene:object}); await settled;
    expect(mock.renderers).toHaveLength(action==='replace'?1:0);
    expect(host.querySelectorAll('canvas')).toHaveLength(action==='replace'?1:0);
    expect(rendered).toHaveBeenCalledTimes(action==='replace'?1:0); expect(errors).not.toHaveBeenCalled();
    for(const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:child'); expect(session.getState().loading).toBe(false);
  });

  it('releases shared GPU resources exactly once and revokes nested object URLs on destroy', async () => {
    const { session } = setup(), { object, spies } = objectFixture(); mock.parse.mockResolvedValueOnce({scene:object});
    const source = new Uint8Array([1]); await session.load(source,context(source,'model.glb')); session.destroy();
    for(const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:child'); expect(mock.renderers[0].dispose).toHaveBeenCalledTimes(1);
  });

  it('removes detached-canvas controls when the model changes', async () => {
    const { host, session } = setup(); await session.load(stl(),context(stl(),'old.stl')); const old = host.querySelector('canvas')!;
    await session.load(stl(),context(stl(),'current.stl')); const scale = session.getState().scale;
    old.dispatchEvent(new WheelEvent('wheel',{deltaY:-1,cancelable:true})); expect(session.getState().scale).toBe(scale);
  });

  it('clears an old canvas when the next format is invalid', async () => {
    const { host, session } = setup(); await session.load(stl(),context(stl()));
    await expect(session.load(stl(),context(stl(),'bad.unknown'))).rejects.toThrow('3D preview currently supports');
    expect(host.querySelector('canvas')).toBeNull(); expect(session.getState().loading).toBe(false);
  });

  it('snapshots ArrayBuffer input before the caller modifies it at the first await', async () => {
    const { session } = setup(), encoded = stl(), source = new ArrayBuffer(encoded.byteLength), bytes = new Uint8Array(source); bytes.set(encoded);
    const load = session.load(source,context(source)); bytes.fill(0); await load;
    expect(session.getState()).toMatchObject({error:null,metadata:{triangleCount:1}});
  });
});
