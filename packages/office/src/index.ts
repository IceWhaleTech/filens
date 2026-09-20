import './style.css';

import {
  DEFAULT_FORMAT_ROUTES,
  createPptxPreviewDriver,
  type FormatDefinition,
  type PreviewDriver
} from '@filens/core';
import { createDocxPreviewDriver, createDocxPreviewRoutes } from '@filens/docx';
import { createIworkPreviewDriver, createIworkPreviewRoutes } from '@filens/iwork';
import { createPdfPreviewDriver, createPdfPreviewRoutes } from '@filens/pdf';
import { createXlsxPreviewDriver, createXlsxPreviewRoutes } from '@filens/xlsx';

const OFFICE_DRIVER_IDS = new Set(['pptx', 'pdf', 'docx', 'xlsx']);
const OFFICE_CORE_ROUTES = DEFAULT_FORMAT_ROUTES.filter((route) => OFFICE_DRIVER_IDS.has(route.driverId));

export function createOfficePreviewDrivers(): PreviewDriver[] {
  return [
    createPptxPreviewDriver(),
    createPdfPreviewDriver(),
    createDocxPreviewDriver(),
    createXlsxPreviewDriver(),
    createIworkPreviewDriver()
  ];
}

export function createOfficePreviewRoutes(baseRoutes = OFFICE_CORE_ROUTES): FormatDefinition[] {
  return createIworkPreviewRoutes(
    createPdfPreviewRoutes(createDocxPreviewRoutes(createXlsxPreviewRoutes(baseRoutes)))
  );
}
