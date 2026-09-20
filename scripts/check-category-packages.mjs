import assert from 'node:assert/strict';

import { createArchiveCategoryPreviewRoutes } from '../packages/archive/dist/index.js';
import { createDesignPreviewDrivers, createDesignPreviewRoutes } from '../packages/design/dist/index.js';
import { createMediaPreviewDrivers, createMediaPreviewRoutes } from '../packages/media/dist/index.js';
import { createOfficePreviewDrivers, createOfficePreviewRoutes } from '../packages/office/dist/index.js';
import { createTextPreviewDrivers, createTextPreviewRoutes } from '../packages/text/dist/index.js';

function ids(items, key = 'id') {
  return [...new Set(items.map((item) => item[key]))].sort();
}

assert.deepEqual(ids(createOfficePreviewDrivers()), ['docx', 'iwork', 'pdf', 'pptx', 'xlsx']);
assert.deepEqual(ids(createOfficePreviewRoutes(), 'driverId'), ['docx', 'iwork', 'pdf', 'pptx', 'xlsx']);
assert.deepEqual(ids(createDesignPreviewDrivers()), ['cad', 'diagram', 'mindmap', 'model3d']);
assert.deepEqual(ids(createDesignPreviewRoutes(), 'driverId'), ['cad', 'diagram', 'mindmap', 'model3d']);
assert.deepEqual(ids(createMediaPreviewDrivers()), ['image', 'media', 'panorama']);
assert.deepEqual(ids(createMediaPreviewRoutes(), 'driverId'), ['image', 'media', 'panorama']);
assert.deepEqual(ids(createTextPreviewDrivers()), ['ebook', 'html', 'text']);
assert.deepEqual(ids(createTextPreviewRoutes(), 'driverId'), ['ebook', 'html', 'text']);
assert.deepEqual(ids(createArchiveCategoryPreviewRoutes(), 'driverId'), ['archive']);

console.log('Category package boundaries OK.');
