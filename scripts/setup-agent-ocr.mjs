import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadOCRModels, modelSources, requestedSourceCount } from './download-agent-models.mjs';
import { downloadArtifact } from './model-download.mjs';
import { buildMacNCNN, buildOCRWrapper } from './build-agent-ncnn-macos.mjs';
import { buildWindowsNCNN } from './build-agent-ncnn-windows.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'converter/rapidocr/runtime.json'), 'utf8'));

export async function setupOCR(bundle, options = {}) {
  const platform = options.platform ?? `${process.platform}-${process.arch}`;
  const artifacts = manifest.platforms[platform];
  if (!artifacts) throw new Error(`Native OCR is not yet packaged for ${platform}`);
  const native = path.resolve(bundle, 'native');
  await mkdir(native, { recursive: true });
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('OCR setup canceled'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  try {
    const results = await Promise.allSettled([
      downloadOCRModels(bundle, { ...options, signal }),
      ...(platform === 'darwin-arm64' ? [] : artifacts.filter(a => a.name === 'libncnn.so')).map(artifact => downloadArtifact({ ...artifact, path: path.join(native, artifact.name), sources: modelSources(artifact, options.sourceCount ?? 3, manifest) }, {
        ...options, signal,
        onEvent(event) {
          if (event.type === 'probe') console.error(`[${event.artifact}] ${event.source}: ${event.error ?? `${(event.bytesPerSecond / 1048576).toFixed(2)} MiB/s`}`);
          if (event.type === 'cached' || event.type === 'complete') console.error(`[${event.artifact}] verified`);
          options.onEvent?.(event);
        }
      }))
    ]);
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length) throw new AggregateError(failed.map(r => r.reason), 'Native OCR setup failed');
    if (platform === 'darwin-arm64') {
      const destination = path.join(native, 'libncnn.dylib');
      if (process.env.FILENS_NCNN_LIBRARY) {
        await copyFile(process.env.FILENS_NCNN_LIBRARY, destination);
      } else {
        try { await stat(destination); }
        catch { await buildMacNCNN(native, { signal }); }
      }
    }
    if (platform === 'win32-x64') await buildWindowsNCNN(native, { signal });
    await buildOCRWrapper(native, { signal, sourceCount:options.sourceCount ?? 3, platform });
    await writeFile(path.join(native, 'runtime.json'), JSON.stringify({ version: manifest.version, platform, artifacts: results.slice(1).map(r => r.value) }, null, 2) + '\n');
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await setupOCR(path.join(root, 'dist', ...(process.argv.includes('--lite') ? ['agent-lite'] : [])), { sourceCount: requestedSourceCount(process.argv), force: process.argv.includes('--refresh') });
  console.log('Native RapidOCR NCNN is ready: no Python, max side 960, OpenMP threads 2.');
}
