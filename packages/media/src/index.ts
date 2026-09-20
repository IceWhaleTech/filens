import './style.css';

import {
  DEFAULT_FORMAT_ROUTES,
  createImagePreviewDriver,
  createMediaPreviewDriver,
  type FormatDefinition,
  type PreviewDriver
} from '@filens/core';
import { createPanoramaPreviewDriver, createPanoramaPreviewRoutes, type PanoramaProcessor } from '@filens/panorama';

const MEDIA_DRIVER_IDS = new Set(['image', 'media']);
const MEDIA_CORE_ROUTES = DEFAULT_FORMAT_ROUTES.filter((route) => MEDIA_DRIVER_IDS.has(route.driverId));

export interface MediaPreviewDriverOptions {
  panoramaProcessor?: PanoramaProcessor;
}

export function createMediaPreviewDrivers(options: MediaPreviewDriverOptions = {}): PreviewDriver[] {
  return [createImagePreviewDriver(), createMediaPreviewDriver(), createPanoramaPreviewDriver({ processor: options.panoramaProcessor })];
}

export function createMediaPreviewRoutes(baseRoutes = MEDIA_CORE_ROUTES): FormatDefinition[] {
  return createPanoramaPreviewRoutes(baseRoutes);
}
