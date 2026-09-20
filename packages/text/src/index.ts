import './style.css';

import {
  DEFAULT_FORMAT_ROUTES,
  createHtmlPreviewDriver,
  createTextPreviewDriver,
  type FormatDefinition,
  type PreviewDriver
} from '@filens/core';
import { createEbookPreviewDriver, createEbookPreviewRoutes } from '@filens/ebook';

const TEXT_DRIVER_IDS = new Set(['text', 'html']);
const TEXT_CORE_ROUTES = DEFAULT_FORMAT_ROUTES.filter((route) => TEXT_DRIVER_IDS.has(route.driverId));

export function createTextPreviewDrivers(): PreviewDriver[] {
  return [createTextPreviewDriver(), createHtmlPreviewDriver(), createEbookPreviewDriver()];
}

export function createTextPreviewRoutes(baseRoutes = TEXT_CORE_ROUTES): FormatDefinition[] {
  return createEbookPreviewRoutes(baseRoutes);
}
