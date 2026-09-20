import type { PreviewResourceResolver, PreviewSource } from './types';

export interface FileSetResource {
  name: string;
  source: PreviewSource;
  path?: string;
  contentType?: string;
}

export interface FileSetResourceResolverOptions {
  root?: string;
}

export interface FileSetResourceIndex {
  resources: FileSetResource[];
  resolve: PreviewResourceResolver;
  read(name: string): FileSetResource | undefined;
}

export function createFileSetResourceIndex(
  resources: Iterable<FileSetResource | File | Blob>,
  options: FileSetResourceResolverOptions = {}
): FileSetResourceIndex {
  const normalizedResources = [...resources].map(normalizeFileSetResource);
  const root = normalizeResourcePath(options.root ?? '');
  const exact = new Map<string, FileSetResource>();
  const rooted = new Map<string, FileSetResource>();
  const basenameCandidates = new Map<string, FileSetResource | null>();

  for (const resource of normalizedResources) {
    const aliases = uniqueValues([
      normalizeResourcePath(resource.path ?? ''),
      normalizeResourcePath(resource.name)
    ]).filter(Boolean);
    for (const alias of aliases) {
      exact.set(alias, resource);
      if (root && alias.startsWith(`${root}/`)) {
        rooted.set(alias.slice(root.length + 1), resource);
      }
    }
    const basename = normalizeResourcePath(resource.name).split('/').pop();
    if (basename) {
      basenameCandidates.set(basename, basenameCandidates.has(basename) ? null : resource);
    }
  }

  const basename = new Map([...basenameCandidates.entries()].filter((entry): entry is [string, FileSetResource] => entry[1] != null));

  return {
    resources: normalizedResources,
    resolve: (request) => {
      const resource = findFileSetResource(request.source ?? request.name ?? '', exact, rooted, basename);
      if (!resource) {
        return undefined;
      }
      return {
        source: resource.source
      };
    },
    read: (name) => findFileSetResource(name, exact, rooted, basename)
  };
}

export function createFileSetResourceResolver(
  resources: Iterable<FileSetResource | File | Blob>,
  options: FileSetResourceResolverOptions = {}
): PreviewResourceResolver {
  return createFileSetResourceIndex(resources, options).resolve;
}

function normalizeFileSetResource(resource: FileSetResource | File | Blob): FileSetResource {
  if (resource instanceof Blob) {
    const file = resource as File;
    const name = typeof file.name === 'string' && file.name ? file.name : 'resource';
    return {
      name,
      path: typeof file.webkitRelativePath === 'string' ? file.webkitRelativePath : undefined,
      contentType: resource.type || undefined,
      source: resource
    };
  }
  return resource;
}

function findFileSetResource(
  name: string,
  exact: Map<string, FileSetResource>,
  rooted: Map<string, FileSetResource>,
  basename: Map<string, FileSetResource>
): FileSetResource | undefined {
  const normalized = normalizeResourcePath(name);
  if (!normalized) {
    return undefined;
  }
  return exact.get(normalized) ?? rooted.get(normalized) ?? basename.get(normalized.split('/').pop() ?? '');
}

function normalizeResourcePath(path: string): string {
  const withoutSuffix = String(path ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^[a-z]+:\/\/[^/]+\//i, '')
    .replace(/^[a-z]:\//i, '')
    .replace(/^\/+/, '')
    .split(/[?#]/)[0] ?? '';
  const parts: string[] = [];
  for (const part of withoutSuffix.split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(decodeResourcePathPart(part));
  }
  return parts.join('/');
}

function decodeResourcePathPart(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}
