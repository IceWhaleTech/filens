import { afterEach, describe, expect, it, vi } from 'vitest';
import { PanoramaPreviewSession } from '../src/preview-driver';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const pending = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pending.set(++next, callback); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
  const session = new PanoramaPreviewSession(document.createElement('div'));
  const canvas = document.createElement('canvas');
  canvas.setPointerCapture = vi.fn(); canvas.releasePointerCapture = vi.fn();
  const renderer = { domElement: canvas, render: vi.fn(), setSize: vi.fn(), dispose: vi.fn() };
  const camera = { lookAt: vi.fn(), updateProjectionMatrix: vi.fn(), fov: 75, aspect: 1 };
  const internal = session as unknown as {
    state: { family: string };
    finishScene(renderer: unknown, scene: unknown, camera: unknown): void;
    resize(): void;
  };
  internal.finishScene(renderer, {}, camera);
  const flush = () => { const callbacks = [...pending.values()]; pending.clear(); for (const cb of callbacks) cb(0); };
  return { session, internal, canvas, renderer, camera, pending, flush };
}

describe('panorama still-image frame scheduling', () => {
  it('keeps the displayed frame without drawing an unchanged still photo', () => {
    const { session, renderer, pending, flush } = fixture();
    flush();
    expect(renderer.render).toHaveBeenCalledOnce();
    expect(pending.size).toBe(0);
    flush();
    expect(renderer.render).toHaveBeenCalledOnce();
    session.destroy();
  });

  it('redraws after zoom, drag and resize, coalescing changes in one frame', () => {
    const { session, internal, canvas, renderer, camera, pending, flush } = fixture();
    flush(); renderer.render.mockClear(); camera.lookAt.mockClear();
    session.setScale(1.3); session.setScale(1.5); internal.resize();
    expect(pending.size).toBe(1);
    flush(); expect(renderer.render).toHaveBeenCalledOnce();
    const initialView = camera.lookAt.mock.calls.at(-1);
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { clientX: 0, clientY: 0, pointerId: 1 }));
    canvas.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 100, clientY: 50, pointerId: 1 }));
    flush();
    expect(camera.lookAt.mock.calls.at(-1)).not.toEqual(initialView);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(pending.size).toBe(0);
    session.destroy();
  });

  it('continues updating video and cancels scheduled work on destroy', () => {
    const { session, internal, renderer, pending, flush } = fixture();
    internal.state.family = 'panorama-video';
    flush(); flush();
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(pending.size).toBe(1);
    session.destroy();
    expect(pending.size).toBe(0);
  });
});
