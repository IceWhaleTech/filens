import './style.css';

import type { FormatDefinition, PreviewDriver } from '@filens/core';
import { createCadPreviewDriver, createCadPreviewRoutes } from '@filens/cad';
import { createDiagramPreviewDriver, createDiagramPreviewRoutes } from '@filens/diagram';
import { createMindmapPreviewDriver, createMindmapPreviewRoutes } from '@filens/mindmap';
import { createModel3dPreviewDriver, createModel3dPreviewRoutes } from '@filens/model3d';

export function createDesignPreviewDrivers(): PreviewDriver[] {
  return [
    createCadPreviewDriver(),
    createDiagramPreviewDriver(),
    createMindmapPreviewDriver(),
    createModel3dPreviewDriver()
  ];
}

export function createDesignPreviewRoutes(baseRoutes: FormatDefinition[] = []): FormatDefinition[] {
  return createCadPreviewRoutes(
    createDiagramPreviewRoutes(createModel3dPreviewRoutes(createMindmapPreviewRoutes(baseRoutes)))
  );
}
