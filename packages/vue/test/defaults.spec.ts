import { createPreviewAcceptAttribute, listPreviewFormats, resolveFormatRoute } from '@filens/core';
import { describe, expect, it } from 'vitest';
import { createVueDefaultPreviewRoutes } from '../src/defaults';
import conversionManifest from '../../../wasm/converter-core/manifest/conversions.json';

describe('createVueDefaultPreviewRoutes', () => {
  it('preserves DNG calibration before conversion when RAW panorama preview is enabled', () => {
    expect(resolveFormatRoute({ name: 'camera.dng' }, { routes: createVueDefaultPreviewRoutes({ rawPreview: true }) })).toMatchObject({
      driverId: 'raw-image', family: 'image', sourceFormat: 'dng', targetFormat: 'jpg'
    });
    expect(resolveFormatRoute({ name: 'camera.dng' }, { routes: createVueDefaultPreviewRoutes() })).toMatchObject({
      driverId: 'image', conversion: { required: true }
    });
    expect(resolveFormatRoute({ name: 'camera.cr2' }, { routes: createVueDefaultPreviewRoutes({ rawPreview: true }) })).toMatchObject({
      driverId: 'image', conversion: { required: true }
    });
  });
  it('keeps Vue default conversions limited to legacy and compatible documents normalized to OpenXML', () => {
    const routes = createVueDefaultPreviewRoutes();
    const conversionFormats = listPreviewFormats({ routes, includeDirect: false, includeConversion: true });

    expect(conversionFormats.map((format) => `${format.extension}->${format.targetFormat}`)).toEqual(
      conversionManifest
        .filter((pair) => pair.sourceFormat !== 'epub' && pair.sourceFormat !== pair.targetFormat)
        .map((pair) => `${pair.sourceFormat}->${pair.targetFormat}`)
    );
    expect(resolveFormatRoute({ name: 'book.epub' }, { routes })).toMatchObject({ driverId: 'ebook', targetFormat: 'epub' });

    for (const testCase of [
      'photo.jpg',
      'photo.webp',
      'photo.svg',
      'photo.bmp',
      'photo.avif',
      'binary.xlsb',
      'drawing.graffle',
      'movie.mkv',
      'bundle.rar',
      'a.pages',
      'a.key',
      'a.numbers',
      'a.docx', 'a.xlsx', 'a.pptx'
    ]) {
      const route = resolveFormatRoute({ name: testCase }, { routes });
      expect(route?.conversion?.required).not.toBe(true);
    }
  });

  it('includes Vue direct preview routes and their image accept types', () => {
    const routes = createVueDefaultPreviewRoutes();
    const accept = createPreviewAcceptAttribute({ routes });

    expect(resolveFormatRoute({ name: 'drawing.dxf' }, { routes })).toMatchObject({ driverId: 'cad', targetFormat: 'dxf' });
    expect(resolveFormatRoute({ name: 'scene.glb' }, { routes })).toMatchObject({ driverId: 'model3d', sourceFormat: 'glb' });
    expect(resolveFormatRoute({ name: 'plan.xmind' }, { routes })).toMatchObject({ driverId: 'mindmap', sourceFormat: 'xmind' });
    expect(resolveFormatRoute({ name: 'flow.drawio' }, { routes })).toMatchObject({ driverId: 'diagram', sourceFormat: 'drawio' });
    expect(resolveFormatRoute({ name: 'photo.png' }, { routes })).toMatchObject({ driverId: 'image', targetFormat: 'png' });
    expect(resolveFormatRoute({ name: 'photo.jpg' }, { routes })).toMatchObject({ driverId: 'image', targetFormat: 'jpg' });
    expect(resolveFormatRoute({ name: 'photo.webp' }, { routes })).toMatchObject({ driverId: 'image', targetFormat: 'webp' });
    expect(resolveFormatRoute({ name: 'photo.avif' }, { routes })).toMatchObject({ driverId: 'image', targetFormat: 'avif' });
    expect(resolveFormatRoute({ name: 'photo.apng' }, { routes })).toMatchObject({ driverId: 'image', targetFormat: 'apng' });
    expect(resolveFormatRoute({ name: 'photo.ico' }, { routes })).toMatchObject({ driverId: 'image', targetFormat: 'ico' });
    for (const descriptor of [{ name: 'iPhone.HEIC' }, { name: 'photo.heif' }, { contentType: 'image/heic' }, { contentType: 'image/heif' }]) {
      expect(resolveFormatRoute(descriptor, { routes })).toMatchObject({ driverId: 'heif-image', family: 'image' });
    }
    expect(resolveFormatRoute({ name: 'photo.icns' }, { routes })).toMatchObject({ driverId: 'image', targetFormat: 'png', conversion: { required: true } });
    expect(resolveFormatRoute({ name: 'drawing.svg' }, { routes })).toMatchObject({ driverId: 'image', targetFormat: 'svg' });

    for (const supported of ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.apng', '.ico', '.svg', '.bmp', 'image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/apng', 'image/x-icon', 'image/svg+xml', 'application/x-icns']) {
      expect(accept).toContain(supported);
    }
  });

  it('falls back to allowed legacy and compatible document MIME types only', () => {
    const routes = createVueDefaultPreviewRoutes();
    const accept = createPreviewAcceptAttribute({ routes });

    for (const [contentType, sourceFormat, targetFormat, driverId] of [
      ['application/msword', 'doc', 'docx', 'docx'],
      ['application/vnd.ms-word.document.macroenabled.12', 'docm', 'docx', 'docx'],
      ['application/vnd.ms-word.template.macroenabled.12', 'dotm', 'docx', 'docx'],
      ['application/rtf; charset=binary', 'rtf', 'docx', 'docx'],
      ['application/vnd.oasis.opendocument.text', 'odt', 'docx', 'docx'],
      ['application/vnd.oasis.opendocument.text-template', 'ott', 'docx', 'docx'],
      ['application/vnd.oasis.opendocument.text-flat-xml', 'fodt', 'docx', 'docx'],
      ['application/vnd.sun.xml.writer', 'sxw', 'docx', 'docx'],
      ['application/vnd.sun.xml.writer.template', 'stw', 'docx', 'docx'],
      ['application/wps-office.wpt', 'wpt', 'docx', 'docx'],
      ['application/vnd.ms-excel', 'xls', 'xlsx', 'xlsx'],
      ['application/vnd.ms-excel.sheet.macroenabled.12', 'xlsm', 'xlsx', 'xlsx'],
      ['application/vnd.ms-excel.template.macroenabled.12', 'xltm', 'xlsx', 'xlsx'],
      ['application/vnd.oasis.opendocument.spreadsheet', 'ods', 'xlsx', 'xlsx'],
      ['application/vnd.oasis.opendocument.spreadsheet-template', 'ots', 'xlsx', 'xlsx'],
      ['application/vnd.oasis.opendocument.spreadsheet-flat-xml', 'fods', 'xlsx', 'xlsx'],
      ['application/vnd.sun.xml.calc', 'sxc', 'xlsx', 'xlsx'],
      ['application/vnd.sun.xml.calc.template', 'stc', 'xlsx', 'xlsx'],
      ['application/wps-office.ett', 'ett', 'xlsx', 'xlsx'],
      ['application/x-dbf', 'dbf', 'xlsx', 'xlsx'],
      ['text/spreadsheet', 'slk', 'xlsx', 'xlsx'],
      ['application/x-dif', 'dif', 'xlsx', 'xlsx'],
      ['text/tab-separated-values', 'tsv', 'xlsx', 'xlsx'],
      ['application/vnd.ms-powerpoint', 'ppt', 'pptx', 'pptx'],
      ['application/vnd.ms-powerpoint.presentation.macroenabled.12', 'pptm', 'pptx', 'pptx'],
      ['application/vnd.ms-powerpoint.slideshow.macroenabled.12', 'ppsm', 'pptx', 'pptx'],
      ['application/vnd.ms-powerpoint.template.macroenabled.12', 'potm', 'pptx', 'pptx'],
      ['application/vnd.oasis.opendocument.presentation', 'odp', 'pptx', 'pptx'],
      ['application/vnd.oasis.opendocument.presentation-template', 'otp', 'pptx', 'pptx'],
      ['application/vnd.oasis.opendocument.presentation-flat-xml', 'fodp', 'pptx', 'pptx'],
      ['application/vnd.sun.xml.impress', 'sxi', 'pptx', 'pptx'],
      ['application/vnd.sun.xml.impress.template', 'sti', 'pptx', 'pptx'],
      ['application/vnd.oasis.opendocument.graphics', 'odg', 'pptx', 'pptx'],
      ['application/vnd.oasis.opendocument.graphics-template', 'otg', 'pptx', 'pptx'],
      ['application/vnd.oasis.opendocument.graphics-flat-xml', 'fodg', 'pptx', 'pptx'],
      ['application/vnd.sun.xml.draw', 'sxd', 'pptx', 'pptx'],
      ['application/vnd.sun.xml.draw.template', 'std', 'pptx', 'pptx'],
      ['application/wps-office.dpt', 'dpt', 'pptx', 'pptx']
    ] as const) {
      expect(resolveFormatRoute({ contentType }, { routes })).toMatchObject({
        sourceFormat,
        targetFormat,
        driverId,
        conversion: { required: true }
      });
      expect(accept).toContain(contentType.split(';', 1)[0]);
    }

    expect(resolveFormatRoute({ contentType: 'text/html' }, { routes })).toMatchObject({
      sourceFormat: 'html',
      targetFormat: 'html',
      driverId: 'html'
    });
    expect(resolveFormatRoute({ contentType: 'application/json' }, { routes })).toMatchObject({
      sourceFormat: 'json',
      targetFormat: 'json',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ contentType: 'text/plain' }, { routes })).toMatchObject({
      sourceFormat: 'txt',
      targetFormat: 'txt',
      driverId: 'text'
    });

    for (const forbidden of [
      'application/vnd.oasis.opendocument.text-master',
      'application/vnd.oasis.opendocument.text-web',
      'application/vnd.sun.xml.writer.global',
      'application/vnd.ms-excel.addin.macroenabled.12',
      'application/x-rar-compressed',
      'application/vnd.apple.pages',
      'application/vnd.apple.keynote',
      'application/vnd.apple.numbers'
    ]) {
      expect(resolveFormatRoute({ contentType: forbidden }, { routes })?.conversion?.required).not.toBe(true);
      expect(accept).not.toContain(forbidden);
    }
  });
});
