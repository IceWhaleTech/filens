import { describe, expect, it, vi } from 'vitest';
import { createPanoramaPreviewDriver, createPanoramaPreviewRoutes } from '../src';
import {
  PanoramaPreviewSession,
  getPanoramaProjectionWarning,
  isEquirectangularSize,
  normalizePanoramaLoadError,
  orderInstaPair,
  resolvePanoramaContentType,
  resolvePanoramaSource
} from '../src/preview-driver';

describe('Panorama preview driver', () => {
  it('exposes opt-in panorama routes and driver support', () => {
    const routes = createPanoramaPreviewRoutes();
    const route = routes.find((item) => item.extensions.includes('pano'));
    const driver = createPanoramaPreviewDriver();

    expect(route).toMatchObject({
      targetFormat: 'pano',
      family: 'panorama',
      driverId: 'panorama',
      contentTypes: ['image/panorama', 'image/x-panorama', 'image/x-insta360', 'application/vnd.filens.panorama+image']
    });
    expect(route?.conversion).toBeUndefined();
    expect(driver.supports('pano')).toBe(true);
    expect(driver.supports('.PANORAMA')).toBe(true);
    expect(driver.supports('.INSP')).toBe(true);
    expect(driver.supports('.INSV')).toBe(true);
    expect(driver.supports('.OSV')).toBe(true);
    expect(driver.supports('jpg')).toBe(false);
    expect(routes.find((item) => item.extensions.includes('insv'))).toMatchObject({
      family: 'panorama-video',
      driverId: 'panorama',
      targetFormat: '360v'
    });
  });

  it('recognizes stitched 2:1 media without accepting dual-fisheye layouts', () => {
    expect(isEquirectangularSize(6528, 3264)).toBe(true);
    expect(isEquirectangularSize(3840, 2160)).toBe(false);
    expect(isEquirectangularSize(0, 0)).toBe(false);
    expect(getPanoramaProjectionWarning(6528, 3264)).toBeUndefined();
    expect(getPanoramaProjectionWarning(3840, 2160)).toContain('vendor stitching');
  });

  it('explains when a vendor raw panorama cannot be decoded by the browser', () => {
    expect(normalizePanoramaLoadError(new Error('decode failed'), '.INSV').message).toContain('vendor app');
    expect(normalizePanoramaLoadError(new Error('decode failed'), '360v').message).toBe('decode failed');
    expect(resolvePanoramaContentType('.INSP')).toBe('image/jpeg');
    expect(resolvePanoramaContentType('insv', 'application/octet-stream')).toBe('video/mp4');
  });

  it('fetches remote INSP attachments before image decoding', async () => {
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(blob));
    vi.stubGlobal('fetch', fetchMock);

    const resolved = await resolvePanoramaSource('https://example.com/photo.insp', 'insp') as Blob;
    expect(resolved.size).toBeGreaterThan(0);
    await expect(resolvePanoramaSource('https://example.com/video.insv', 'insv')).resolves.toBe('https://example.com/video.insv');
    expect(fetchMock).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it('uses the matching Osmo LRF sidecar for OSV preview', async () => {
    const proxy = new Blob(['proxy'], { type: 'video/mp4' });
    const session = new PanoramaPreviewSession(document.createElement('div'), {
      resourceResolver: ({ name }) => name === 'CAM_001.LRF' ? proxy : undefined
    });

    await expect((session as unknown as {
      resolveOsmoProxy(name?: string): Promise<Blob>;
    }).resolveOsmoProxy('CAM_001.OSV')).resolves.toBe(proxy);
    expect(session.getState().warnings[0]).toContain('DJI Studio stitched 2:1 export');

    const missingProxySession = new PanoramaPreviewSession(document.createElement('div'));
    await expect((missingProxySession as unknown as {
      resolveOsmoProxy(name?: string): Promise<Blob>;
    }).resolveOsmoProxy('CAM_001.OSV')).rejects.toThrow('Upload both files together');
  });

  it('resolves the opposite ONE RS lens file without guessing another model', async () => {
    const companion = new Blob(['lens-1'], { type: 'video/mp4' });
    const session = new PanoramaPreviewSession(document.createElement('div'), {
      resourceResolver: ({ name }) => name === 'VID_20220101_10_001.insv' ? companion : undefined
    });
    await expect((session as unknown as {
      resolveInstaCompanion(name?: string): Promise<Blob>;
    }).resolveInstaCompanion('VID_20220101_00_001.insv')).resolves.toBe(companion);
  });

  it('keeps ONE RS lens files in _00 then _10 calibration order', () => {
    const lens00 = new Blob(['00']);
    const lens10 = new Blob(['10']);
    expect(orderInstaPair(lens10, lens00, 'VID_20220101_10_001.insv')).toEqual({
      source: lens00,
      companion: lens10,
      primaryName: 'VID_20220101_00_001.insv'
    });
  });

  it('provides play and committed seek controls for calibrated video', () => {
    const host = document.createElement('div');
    const session = new PanoramaPreviewSession(host);
    const renderer = {
      paused: false,
      duration: 10,
      currentTime: 2,
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn()
    };
    const internal = session as unknown as {
      calibratedRenderer: typeof renderer;
      createCalibratedControls(value: typeof renderer): void;
    };
    internal.calibratedRenderer = renderer;
    internal.createCalibratedControls(renderer);

    (host.querySelector('button') as HTMLButtonElement).click();
    expect(renderer.pause).toHaveBeenCalledOnce();
    const timeline = host.querySelector('input[type="range"]') as HTMLInputElement;
    timeline.value = '6';
    timeline.dispatchEvent(new Event('change'));
    expect(renderer.seek).toHaveBeenCalledWith(6);
  });
});
