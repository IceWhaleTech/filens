import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './agent-rust-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fallbacks = new Map();
// This old import-library crate omits both license files and Cargo VCS metadata.
// The pinned winapi 0.3.9 tree contains the same 0.4.0 crate and its MIT/Apache licenses.
const licenseRevisions = {
  'winapi-x86_64-pc-windows-gnu@0.4.0':'796a8e6c2971dc2ff1bcff166e6671284f9b5b6b',
  // 0.4.0 declares MIT but omits the text in both its crate and source tree.
  // Include the same project's later, pinned MIT notice, with its provenance.
  'convert_case@0.4.0':'fbbca84796dfa288d5a7b8673858ca2867c0414a'
};
async function upstreamLicense(dependency, base) {
  const repository = /^https:\/\/github.com\/([^/]+\/[^/]+)/.exec(dependency.repository ?? dependency.homepage ?? '')?.[1];
  const revision = licenseRevisions[`${dependency.name}@${dependency.version}`] ?? JSON.parse(await readFile(path.join(base,'.cargo_vcs_info.json'),'utf8')).git.sha1;
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
export async function writeRustLicenses(directory, options = {}) {
  const graphs = options.graphs ?? [
    ...['aarch64-apple-darwin','x86_64-unknown-linux-gnu','aarch64-unknown-linux-gnu','x86_64-pc-windows-gnu'].map(target=>({manifest:'cli/Cargo.toml',target})),
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
  const sections = [options.heading ?? 'Rust CLI and shared WASM dependency notices (locked Cargo manifests)\n'];
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
    const files = (await readdir(base)).filter(name=>/^(?:LICENSES?|LICENCES?|COPYING|COPYRIGHT|NOTICE)(?:[._-].*)?$/i.test(name));
    if (dependency.license_file && !files.includes(dependency.license_file)) files.push(dependency.license_file);
    sections.push(`\n${dependency.name} ${dependency.version}\nLicense: ${dependency.license ?? 'see included license'}\n${dependency.repository ?? ''}\n`);
    if (!files.length) recordLicense(await upstreamLicense(dependency,base));
    async function include(file) {
      try { const text = await readFile(path.join(base,file),'utf8'); sections.push(`\n--- ${file} ---\n`); recordLicense(text); }
      catch (e) {
        if (e.code !== 'EISDIR') throw e;
        for (const child of (await readdir(path.join(base,file))).sort()) await include(path.join(file,child));
      }
    }
    for (const file of files.sort()) await include(file);
  }
  await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,options.filename ?? 'rust-cli.txt'),sections.join('\n')+'\n');
}
