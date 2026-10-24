import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const input = option('--input', 'tmp/performance-other/results/results.json');
const output = option('--output', path.join(path.dirname(input), 'summary.json'));
const result = JSON.parse(fs.readFileSync(input));
const engineering = result.engineering === true || result.runs.some(run => run.engine === 'filens-baseline');
if (result.profiled) throw new Error('Profiled diagnostic runs cannot be used for performance rankings.');
const previewFile = option('--preview-review', path.join(path.dirname(input), 'previews/review.json'));
const previews = fs.existsSync(previewFile) ? JSON.parse(fs.readFileSync(previewFile)) : null;
if (previews && previews.benchmarkResultSha256 !== crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex')) throw new Error('Preview evidence does not match benchmark results');
const median = values => { const a = values.filter(Number.isFinite).sort((x, y) => x - y), i = Math.floor(a.length / 2); return a.length ? a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2 : null; };
let state = 12345;
const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const metrics = ['operationMs', 'initMs', 'firstOperationMs', 'indexMs', 'extractMs'];
const good = r => !r.failure && !r.errors.length;
const summary = result.samples.flatMap(sample => [...new Set(result.runs.filter(r => r.sample === sample.name).map(r => r.engine))].map(engine => {
  const all = result.runs.filter(r => r.sample === sample.name && r.engine === engine), ok = all.filter(good);
  return { family: sample.family, sample: sample.name, engine, attempted: all.length, successes: ok.length,
    ...Object.fromEntries(metrics.map(k => [k, median(ok.map(r => r[k]))])),
    output: ok.length ? Object.fromEntries(['entities', 'types', 'warnings', 'triangles', 'meshes', 'bounds', 'sheets', 'rows', 'cells', 'files', 'expandedBytes', 'contentSha256', 'textSha256', 'textCharacters', 'structure', 'media', 'outputBytes'].filter(k => ok[0][k] !== undefined).map(k => [k, ok[0][k]])) : null,
    failures: [...new Set(all.flatMap(r => [r.failure, ...r.errors]).filter(Boolean))] };
}));
const comparisons = summary.filter(r => r.engine !== 'filens').flatMap(peer => {
  const ours = result.runs.filter(r => r.sample === peer.sample && r.engine === 'filens' && good(r)).sort((a, b) => a.iteration - b.iteration);
  const theirs = result.runs.filter(r => r.sample === peer.sample && r.engine === peer.engine && good(r)).sort((a, b) => a.iteration - b.iteration);
  if (ours.length !== result.iterations || theirs.length !== result.iterations) return [];
  const signature = r => r.contentSha256 ?? (r.family === 'conversion' && r.sample.endsWith('.txt') ? `${r.textSha256}:${r.structure.paragraphs}` : null);
  const matchingContent = Boolean(signature(ours[0])) && ours.every((r, i) => signature(r) === signature(theirs[i]));
  const ourPreview = previews?.runs.find(r => r.sample === peer.sample && r.engine === 'filens' && !r.failure && !r.errors.length);
  const peerPreview = previews?.runs.find(r => r.sample === peer.sample && r.engine === peer.engine && !r.failure && !r.errors.length);
  const matchingExactPreview = Boolean(ourPreview?.displaySha256) && ourPreview.displaySha256 === peerPreview?.displaySha256;
  const matchingPreviewContent = Boolean(ourPreview?.previewContentSha256) && ourPreview.previewContentSha256 === peerPreview?.previewContentSha256;
  const matchingPreview = matchingExactPreview || matchingPreviewContent;
  const matchingOutput = matchingContent;
  const narrowEquivalentTask = ['csv', 'zip', 'step', 'xlsx'].includes(peer.family)
    || peer.family === 'dxf' && peer.sample === 'generated-20000-lines.dxf'
    || peer.family === 'conversion' && (/\.(csv|txt)$/i.test(peer.sample) || matchingPreview);
  return metrics.filter(k => ours.every(r => Number.isFinite(r[k])) && theirs.every(r => Number.isFinite(r[k])) && median(ours.map(r => r[k])) > 0).map(metric => {
    const a = ours.map(r => r[metric]), b = theirs.map(r => r[metric]), distribution = [];
    for (let i = 0; i < 10000; i++) {
      const indices = a.map(() => Math.floor(random() * a.length));
      distribution.push(median(indices.map(i => b[i])) / median(indices.map(i => a[i])));
    }
    distribution.sort((a, b) => a - b);
    const interval = [distribution[250], distribution[9750]];
    return { family: peer.family, sample: peer.sample, peer: peer.engine, metric, filensMs: median(a), peerMs: median(b), ratio: median(b) / median(a), ratio95PercentBootstrapInterval: interval,
      matchingOutput, matchingPreview, matchingExactPreview, matchingPreviewContent, stableTimingLead: interval[0] > 1,
      scopedLead: !engineering && result.iterations >= 7 && interval[0] > 1 && matchingOutput && narrowEquivalentTask && metric !== 'initMs' };
  });
});
const report = { sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'),
  date: result.date, cpu: result.cpu, browser: result.browser, versions: result.versions, iterations: result.iterations, engineering, totalRuns: result.runs.length,
  filensRuns: result.runs.filter(r => r.engine === 'filens').length, filensSuccessfulRuns: result.runs.filter(r => r.engine === 'filens' && good(r)).length,
  method: 'Peer / filens ratios; 10,000 paired percentile bootstrap resamples, LCG seed 12345. Eligibility requires a matching recorded output signature and >=7 iterations. Legacy XLS conversion can qualify when all resolved nonempty cell addresses/text match in the same viewer; tiny decimal differences (12 significant digits) and trailing blank grid space are accepted for preview. Editable formula/structure parity is not required. STEP metadata is deliberately omitted from filens; signatures compare oriented world-space triangles/normals, rounded to 1e-5, with independent full numerical regression checks. No global SOTA proof.',
  previewReview: previews ? { path: path.relative(path.dirname(input), previewFile), benchmarkResultSha256: previews.benchmarkResultSha256 } : null,
  summary, comparisons };
for (const comparison of comparisons) {
  comparison.pairwiseScopedLead = comparison.scopedLead;
  const allPeers = comparisons.filter(c => c.family === comparison.family && c.sample === comparison.sample && c.metric === comparison.metric);
  const expectedPeers = summary.filter(r => r.sample === comparison.sample && r.engine !== 'filens');
  comparison.bestAmongMeasuredPeers = allPeers.length === expectedPeers.length
    && expectedPeers.every(r => r.attempted === result.iterations && r.successes === result.iterations)
    && allPeers.every(c => c.stableTimingLead && c.matchingOutput);
  comparison.scopedLead &&= comparison.bestAmongMeasuredPeers;
}
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ totalRuns: report.totalRuns, filensSuccessful: report.filensSuccessfulRuns, failures: summary.filter(r => r.successes !== r.attempted).map(r => ({ sample: r.sample, engine: r.engine, errors: r.failures })),
  leads: comparisons.filter(c => c.scopedLead).map(c => ({ sample: c.sample, metric: c.metric, ratio: c.ratio, interval: c.ratio95PercentBootstrapInterval })), output }, null, 2));
