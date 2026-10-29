import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadArtifact } from './model-download.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'converter/rapidocr/models.json'), 'utf8'));

export function modelSources(artifact, sourceCount = 3, sourceManifest = manifest) {
  if (![3, 4].includes(sourceCount)) throw new Error('Model source count must be 3 or 4');
  const file = artifact.modelScopePath;
  const sources = [
    { name: 'modelscope', url: `https://modelscope.cn/models/${sourceManifest.modelScopeRepo}/resolve/${sourceManifest.modelScopeRevision}/${file}` },
    { name: 'hf-mirror', url: `https://hf-mirror.com/${sourceManifest.huggingFaceRepo}/resolve/${sourceManifest.huggingFaceRevision}/${artifact.huggingFacePath}` },
    { name: 'huggingface', url: `https://huggingface.co/${sourceManifest.huggingFaceRepo}/resolve/${sourceManifest.huggingFaceRevision}/${artifact.huggingFacePath}` }
  ];
  if (sourceCount === 4) sources.push({ name: 'modelscope-api', url: `https://modelscope.cn/api/v1/models/${sourceManifest.modelScopeRepo}/repo?Revision=${sourceManifest.modelScopeRevision}&FilePath=${encodeURIComponent(file)}` });
  return sources;
}

export async function downloadOCRModels(bundle, options = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('Model download canceled'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    return await prepareModels(bundle, { ...options, signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal });
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

async function prepareModels(bundle, options) {
  const sourceCount = options.sourceCount ?? 3;
  const modelDir = path.join(bundle, 'models', 'rapidocr-ncnn');
  await mkdir(modelDir, { recursive: true });
  let previous = [];
  try {
    const prior = JSON.parse(await readFile(path.join(modelDir, 'download-report.json'), 'utf8')).artifacts;
    if (Array.isArray(prior)) previous = prior;
  } catch { /* First install or invalid old report. */ }
  const reports = [];
  // Model artifacts download concurrently; each file uses up to four
  // range workers after probing mirrors concurrently.
  const results = await Promise.allSettled(manifest.artifacts.map(async artifact => {
    const report = await downloadArtifact({ ...artifact, path: path.join(modelDir, artifact.name), sources: modelSources(artifact, sourceCount) }, {
      ...options,
      onEvent(event) {
        if (event.type === 'probe') {
          console.error(`[${event.artifact}] ${event.source}: ${event.error ?? `${(event.bytesPerSecond / 1048576).toFixed(2)} MiB/s${event.rangeSupported ? ' (Range)' : ''}`}`);
        } else if (event.type === 'complete') {
          console.error(`[${event.artifact}] verified; ${event.sources.join(' + ')}; ${(event.bytesPerSecond / 1048576).toFixed(2)} MiB/s`);
        } else if (event.type === 'cached') console.error(`[${event.artifact}] verified local cache`);
        options.onEvent?.(event);
      }
    });
    const prior = previous.find(p => p.name === report.name && p.sha256 === report.sha256);
    reports.push(report.cached && prior ? { ...prior, cached: true, verifiedAt: new Date().toISOString(), events: [...(prior.events ?? []), ...report.events].slice(-100) } : { ...report, sourceCount, verifiedAt: new Date().toISOString() });
    return report;
  }));
  await writeFile(path.join(modelDir, 'download-report.json'), JSON.stringify({ version: manifest.version, sourceCount, artifacts: reports }, null, 2) + '\n');
  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(r => r.reason), 'OCR model downloads failed');
  await writeFile(path.join(modelDir, '.ready.json'), JSON.stringify({ bundle_id: 'rapidocr-ncnn', artifacts: manifest.artifacts.map(a => a.name) }, null, 2) + '\n');
  return modelDir;
}

export function requestedSourceCount(args) {
  const index = args.indexOf('--sources');
  const count = index < 0 ? 3 : Number(args[index + 1]);
  if (![3, 4].includes(count)) throw new Error('--sources must be 3 or 4');
  return count;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await downloadOCRModels(path.join(root, 'dist', ...(process.argv.includes('--lite') ? ['agent-lite'] : [])), { sourceCount: requestedSourceCount(process.argv), force: process.argv.includes('--refresh') });
}
