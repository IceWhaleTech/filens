import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const defaultTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.apng', 'image/apng'],
  ['.bmp', 'image/bmp'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.icns', 'application/x-icns'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.pdf', 'application/pdf'],
  ['.zip', 'application/zip']
]);
const precompressedExtensions = /\.(?:css|html|js|json|mjs|wasm)$/;

function contentTypeFor(filePath) {
  return defaultTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

function acceptsEncoding(request, encoding) {
  const header = request.headers['accept-encoding'];
  if (!header) return false;
  let wildcard = 0;
  for (const item of header.toLowerCase().split(',')) {
    const [name, ...parameters] = item.trim().split(';');
    const quality = Number(parameters.find((parameter) => parameter.trim().startsWith('q='))?.trim().slice(2) ?? '1');
    if (!Number.isFinite(quality) || quality <= 0) continue;
    if (name === encoding) return quality;
    if (name === '*') wildcard = quality;
  }
  return wildcard;
}

function within(root, target) {
  const rel = path.relative(root, target);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function main() {
  const dirRel = process.argv[2] || 'apps/demo/dist';
  const port = Number(process.argv[3] || '4173');
  const root = path.resolve(rootDir, dirRel);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') pathname = '/index.html';

      const candidate = path.resolve(root, '.' + pathname);
      if (!within(root, candidate)) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      let servedPath = candidate;
      let contentEncoding;
      if (precompressedExtensions.test(candidate)) {
        const variants = acceptsEncoding(req, 'br') ? [['br', `${candidate}.br`]] : [];
        if (acceptsEncoding(req, 'gzip')) variants.push(['gzip', `${candidate}.gz`]);
        for (const [encoding, variant] of variants) {
          const variantStat = await fs.stat(variant).catch(() => null);
          if (variantStat?.isFile()) {
            servedPath = variant;
            contentEncoding = encoding;
            break;
          }
        }
      }

      const st = await fs.stat(servedPath).catch(() => null);
      if (!st || !st.isFile()) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', contentTypeFor(candidate));
      res.setHeader('Content-Length', String(st.size));
      if (precompressedExtensions.test(candidate)) res.setHeader('Vary', 'Accept-Encoding');
      if (contentEncoding) {
        res.setHeader('Content-Encoding', contentEncoding);
      }
      res.setHeader('Cache-Control', 'no-store');
      createReadStream(servedPath).pipe(res);
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err));
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  console.log(`Serving ${path.relative(rootDir, root)} at http://127.0.0.1:${port}`);

  // Keep running until SIGINT.
  process.on('SIGINT', () => server.close(() => process.exit(0)));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
