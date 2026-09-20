export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizePath(pathLike: string): string {
  const parts = pathLike.replace(/\\/g, '/').split('/');
  const output: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') {
      continue;
    }

    if (part === '..') {
      output.pop();
      continue;
    }

    output.push(part);
  }

  return output.join('/');
}

export function resolvePartPath(basePath: string, target: string): string {
  if (target.startsWith('/')) {
    return normalizePath(target.slice(1));
  }

  const baseDir = basePath.split('/').slice(0, -1).join('/');
  return normalizePath(`${baseDir}/${target}`);
}

export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

let idCounter = 0;

export function createId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function deepClone<T>(value: T): T {
  if (value == null || typeof value !== 'object') {
    return value;
  }

  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

export function objectEntries<T extends Record<string, unknown>>(value: T): Array<[keyof T, T[keyof T]]> {
  return Object.entries(value) as Array<[keyof T, T[keyof T]]>;
}
