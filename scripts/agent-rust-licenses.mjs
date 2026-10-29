import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './agent-rust-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fallbacks = new Map();
async function upstreamLicense(dependency, base) {
  const repository = /^https:\/\/github.com\/([^/]+\/[^/]+)/.exec(dependency.repository ?? dependency.homepage ?? '')?.[1];
  const revision = JSON.parse(await readFile(path.join(base,'.cargo_vcs_info.json'),'utf8')).git.sha1;
  if (!repository || !/^[a-f0-9]{40}$/.test(revision)) throw new Error(`Cannot locate pinned license for ${dependency.name}`);
  const key = `${repository.replace('/','-')}-${revision}`;
  if (!fallbacks.has(key)) fallbacks.set(key,(async()=>{
    const cache = path.join(root,'dist/agent-license-cache',`${key}.txt`);
    try { return await readFile(cache,'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const candidates = ['LICENSE','LICENSE.md','LICENSE.txt','LICENSE-MIT','LICENSE-APACHE'];
    const results = await Promise.allSettled(candidates.map(async name=>{
      const url = `https://raw.githubusercontent.com/${repository}/${revision}/${name}`;
      const response = await fetch(url,{signal:AbortSignal.timeout(30000)});
      if (response.status === 404) return '';
      if (!response.ok) throw new Error(`License download HTTP ${response.status}`);
      return `${url}\n\n${await response.text()}`;
    }));
    const texts = results.filter(r=>r.status==='fulfilled' && r.value).map(r=>r.value);
    if (!texts.length) throw new Error(`Missing upstream license for ${dependency.name}`);
    const text = texts.join('\n\n');
    await mkdir(path.dirname(cache),{recursive:true}); await writeFile(cache,text);
    return text;
  })());
  return fallbacks.get(key);
}

// Collect the actual locked dependencies' license texts without retaining
// Cargo's absolute cache paths in distributable metadata.
export async function writeRustLicenses(directory) {
  const graphs = [
    ...['aarch64-apple-darwin','x86_64-unknown-linux-gnu','aarch64-unknown-linux-gnu'].map(target=>({manifest:'cli/Cargo.toml',target})),
    {manifest:'wasm/converter-core-rust/Cargo.toml',target:'wasm32-wasip1',features:'text-extraction'},
    {manifest:'wasm/converter-image-rust/Cargo.toml',target:'wasm32-wasip1'}
  ];
  const metadata = await Promise.all(graphs.map(async ({manifest,target,features})=>
    JSON.parse(await run('cargo',['+1.93.0','metadata','--locked','--format-version','1','--manifest-path',manifest,'--filter-platform',target,...(features?['--features',features]:[])],{capture:true}))));
  const included = new Set();
  for (const graph of metadata) {
    const seen = new Set(); const nodes = new Map(graph.resolve.nodes.map(n=>[n.id,n]));
    function visit(id) { if (seen.has(id)) return; seen.add(id); included.add(id); for (const dep of nodes.get(id).deps) visit(dep.pkg); }
    visit(graph.resolve.root);
  }
  const packages = new Map(metadata.flatMap(graph=>graph.packages).map(p=>[p.id,p]));
  const dependencies = [...packages.values()].filter(p=>(p.source || p.name==='rawloader') && included.has(p.id)).sort((a,b)=>`${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  const sections = ['Rust CLI and shared WASM dependency notices (locked Cargo manifests)\n'];
  const licenseIds = new Map();
  function recordLicense(text) {
    const hash = createHash('sha256').update(text).digest('hex');
    if (licenseIds.has(hash)) { sections.push(`Identical license text: see license-text-${licenseIds.get(hash)} above.\n`); return; }
    const id = licenseIds.size + 1;
    licenseIds.set(hash,id);
    sections.push(`[license-text-${id}]\n${text}`);
  }
  for (const dependency of dependencies) {
    const base = path.dirname(dependency.manifest_path);
    const files = (await readdir(base)).filter(name=>/^(?:LICENSE|LICENCE|COPYING|COPYRIGHT|NOTICE)(?:[._-].*)?$/i.test(name));
    if (dependency.license_file && !files.includes(dependency.license_file)) files.push(dependency.license_file);
    sections.push(`\n${dependency.name} ${dependency.version}\nLicense: ${dependency.license ?? 'see included license'}\n${dependency.repository ?? ''}\n`);
    if (!files.length) recordLicense(await upstreamLicense(dependency,base));
    for (const file of files.sort()) {
      try { sections.push(`\n--- ${path.basename(file)} ---\n`); recordLicense(await readFile(path.join(base,file),'utf8')); }
      catch (e) { if (e.code !== 'EISDIR') throw e; }
    }
  }
  await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,'rust-cli.txt'),sections.join('\n')+'\n');
}
