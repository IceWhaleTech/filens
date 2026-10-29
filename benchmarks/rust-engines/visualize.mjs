import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'docs/assets/rust-engines');
const fixedStep = process.argv.includes('--step-fixed');
const reviewedStep = process.argv.includes('--step-reviewed');
await mkdir(out, { recursive: true });
const { chromium } = await import(path.join(root, 'tmp/rust-engines/tools/node_modules/playwright/index.mjs'));
const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#eef1f5;color:#152239;font:15px system-ui}h1{font-size:23px;margin:0 0 8px}p{color:#4a5970;margin:0 0 20px}.grid{display:flex;gap:16px}article{flex:1;min-width:0;background:white;border-radius:8px;overflow:hidden;border:1px solid #d7deea}h2{font-size:16px;margin:0;padding:12px 16px;background:#f9fafc;border-bottom:1px solid #d7deea}img{display:block;width:100%;height:auto}canvas{display:block;width:100%;height:460px}#capture{max-width:1500px;margin:auto}
</style><div id="capture"><h1></h1><p></p><div class="grid"></div></div><script type="module">
import * as THREE from '/tmp/rust-engines/tools/node_modules/three/build/three.module.js';
const p=new URLSearchParams(location.search),kind=p.get('kind'),id=p.get('id');
const fixed=p.has('fixed');
const reviewed=p.has('reviewed');
const titles={ 'demo-cover':'PDF: standard font fallback', 'unicode-missing-font':'PDF: malformed CMap and missing font', 'type3-first':'PDF: Type3 glyphs', 'assembly':'STEP: embedded assembly placements', 'missing-faces':'STEP: HEAD_FRONT before / after fixes', 'rounded':'STEP: rounded cube before / after fixes' };
document.querySelector('h1').textContent=titles[id];
document.querySelector('p').textContent=kind==='pdf'?'Same PDF page at 96 DPI. Columns: pinned C++ reference and two Rust WASM builds.':'Same camera and material. Geometry comes from the actual WASM outputs.';
const engines=kind==='pdf'?['pdfium','hayro-fonts','hayro-no-fonts']:reviewed?['occt','truck','truck-reviewed']:fixed?['occt','truck','truck-fixed']:['occt','truck'];
let referenceBounds;
for(const engine of engines){
 const article=document.createElement('article'),h=document.createElement('h2');
 h.textContent=({pdfium:'PDFium', 'hayro-fonts':'hayro: fonts + CMaps', 'hayro-no-fonts':'hayro: no embedded fonts / CMaps',occt:'OCCT (current)',truck:fixed||reviewed?'truck: original baseline':'truck (Rust)','truck-fixed':'truck: after display fixes','truck-reviewed':'truck: after review (mm)'})[engine];
 article.append(h);document.querySelector('.grid').append(article);
 if(kind==='pdf'){
  const img=document.createElement('img');img.src='/tmp/rust-engines/output/'+id+'-'+engine+'.png';article.append(img);await img.decode();
 }else{
  const key=id==='assembly'?'cax-if/as1-tu-203.stp':id==='rounded'?'rounded-cube/rounded-cube.step':'cax-if/s1-c5-214/HEAD_FRONT.stp';
  const slug=key.replace(/[^a-zA-Z0-9.-]+/g,'_');
  if(id==='rounded'&&engine==='truck'){const text=document.createElement('p');text.textContent='No mesh: 20 s timeout';text.style='height:460px;display:grid;place-content:center;margin:0';article.append(text);continue;}
  const folder=engine==='truck-reviewed'?'output-step-reviewed':engine==='truck-fixed'?'output-step-fixed':'output';
  const data=await(await fetch('/tmp/rust-engines/'+folder+'/'+slug+'-'+(engine.startsWith('truck')?'truck':engine)+'.json')).json();
  const scale=id==='missing-faces'&&engine!=='occt'&&engine!=='truck-reviewed'?25.4:1;
  if(scale!==1)h.textContent+=' ×25.4 (unit diagnostic)';
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.positions.flat().map(v=>v*scale),3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(data.normals.flat(),3));geometry.computeBoundingBox();
  if(engine==='occt')referenceBounds=geometry.boundingBox.clone();
  const center=referenceBounds.getCenter(new THREE.Vector3()),size=referenceBounds.getSize(new THREE.Vector3()),radius=size.length()/2;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#f7f9fc');
  const material=new THREE.MeshStandardMaterial({color:'#8cabd0',metalness:.08,roughness:.62,side:THREE.DoubleSide});
  scene.add(new THREE.Mesh(geometry,material));scene.add(new THREE.AmbientLight(0xffffff,1.8));
  const keyLight=new THREE.DirectionalLight(0xffffff,3);keyLight.position.copy(center).add(new THREE.Vector3(radius*2,-radius*3,radius*4));scene.add(keyLight);
  const fill=new THREE.DirectionalLight(0xd0e0ff,1);fill.position.copy(center).add(new THREE.Vector3(-radius*2,radius*2,radius));scene.add(fill);
  const width=engines.length===3?450:660,height=460,half=radius*1.08;
  const camera=new THREE.OrthographicCamera(-half*width/height,half*width/height,half,-half,.01,Math.max(100,radius*20));
  camera.up.set(0,0,1);camera.position.copy(center).add(new THREE.Vector3(1.4,-2.0,1.3).normalize().multiplyScalar(radius*4));camera.lookAt(center);
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(width,height);renderer.setPixelRatio(1);renderer.render(scene,camera);article.append(renderer.domElement);
 }
}
window.ready=true;
</script>`;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/viewer') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' })[path.extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 2400 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => console.error(error));
  const cases = reviewedStep ? [['step','assembly','step-reviewed-assembly.png'], ['step','missing-faces','step-reviewed-head.png']] : fixedStep ? [['step','missing-faces','step-fixed-missing-faces.png'], ['step','rounded','step-fixed-rounded.png']] : [['pdf','demo-cover','pdf-fonts.png'], ['pdf','unicode-missing-font','pdf-unicode.png'], ['pdf','type3-first','pdf-type3.png'], ['step','assembly','step-assembly.png'], ['step','missing-faces','step-missing-faces.png']];
  for (const [kind, id, filename] of cases) {
    await page.goto(`http://127.0.0.1:${server.address().port}/viewer?kind=${kind}&id=${id}${reviewedStep ? '&reviewed=1' : fixedStep ? '&fixed=1' : ''}`);
    await page.waitForFunction(() => window.ready === true);
    await page.locator('#capture').screenshot({ path: path.join(out, filename) });
    console.log(filename);
  }
} finally { await browser.close(); server.close(); }
