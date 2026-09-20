import { createArchivePreviewRoutes } from '@filens/archive';
import { createDefaultPreviewRoutes, type FormatDefinition } from '@filens/core';
import { createDesignPreviewRoutes } from '@filens/design';
import { createMediaPreviewRoutes } from '@filens/media';
import { createOfficePreviewRoutes } from '@filens/office';
import { createTextPreviewRoutes } from '@filens/text';

export function createVueDefaultPreviewRoutes(): FormatDefinition[] {
  return createOfficePreviewRoutes(
    createArchivePreviewRoutes(
      createDesignPreviewRoutes(
        createTextPreviewRoutes(createMediaPreviewRoutes(createDefaultPreviewRoutes()))
      )
    )
  );
}
