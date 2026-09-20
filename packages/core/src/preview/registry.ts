import { resolveFormatRoute, type FormatDefinition } from './formats';
import type { FormatRoute, PreviewDriver, PreviewItemState, PreviewOptions, SourceDescriptor } from './types';

export interface PreviewRegistryOptions {
  drivers?: PreviewDriver[];
  routes?: FormatDefinition[];
}

export class PreviewRegistry {
  private readonly drivers = new Map<string, PreviewDriver>();
  private readonly routes?: FormatDefinition[];

  constructor(options: PreviewRegistryOptions = {}) {
    this.routes = options.routes;
    for (const driver of options.drivers ?? []) {
      this.register(driver);
    }
  }

  register(driver: PreviewDriver): void {
    this.drivers.set(driver.id, driver);
  }

  unregister(driverId: string): void {
    this.drivers.delete(driverId);
  }

  getDriver(driverId: string): PreviewDriver | undefined {
    return this.drivers.get(driverId);
  }

  listDrivers(): PreviewDriver[] {
    return [...this.drivers.values()];
  }

  resolve(descriptor: Pick<SourceDescriptor, 'extension' | 'name' | 'contentType'>): ResolvedPreviewRoute | null {
    const route = resolveFormatRoute(descriptor, {
      routes: this.routes
    });
    if (!route) {
      return null;
    }

    return {
      route,
      driver: this.drivers.get(route.driverId)
    };
  }
}

export interface ResolvedPreviewRoute {
  route: FormatRoute;
  driver?: PreviewDriver;
}

export function createPreviewRegistry(options?: PreviewRegistryOptions): PreviewRegistry {
  return new PreviewRegistry(options);
}

export function createUnsupportedState(family: PreviewItemState['family'] = 'unsupported'): PreviewItemState {
  return {
    loading: false,
    error: null,
    family,
    warnings: [],
    capabilities: {}
  };
}

export type { PreviewDriver, PreviewItemState, PreviewOptions };
