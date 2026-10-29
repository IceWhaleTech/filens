// Cross-host ABI/dependency checks; this does not substitute for Windows runs.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const bundle=path.resolve(process.argv[2]??'dist/windows');
const results=[];
for(const name of ['filens.exe','native/ncnn.dll','native/zima_ncnn_runtime_v7.dll']){
  const b=await readFile(path.join(bundle,name));
  assert.equal(b.toString('ascii',0,2),'MZ');const p=b.readUInt32LE(60);assert.equal(b.toString('ascii',p,p+4),'PE\0\0');
  assert.equal(b.readUInt16LE(p+4),0x8664,'expected x64');const n=b.readUInt16LE(p+6),o=p+24;
  assert.equal(b.readUInt16LE(o),0x20b,'expected PE32+');const s=o+b.readUInt16LE(p+20),sections=[];
  for(let i=0;i<n;i++){const a=s+i*40;sections.push({v:b.readUInt32LE(a+12),size:Math.max(b.readUInt32LE(a+8),b.readUInt32LE(a+16)),p:b.readUInt32LE(a+20)});}
  const at=r=>{const s=sections.find(s=>r>=s.v&&r<s.v+s.size);assert.ok(s,'invalid PE address');return r-s.v+s.p;};
  const str=p=>{const end=b.indexOf(0,p);assert.ok(end>=p);return b.toString('ascii',p,end);};let imports=[],exports=[];
  const ir=b.readUInt32LE(o+120);if(ir)for(let a=at(ir);b.readUInt32LE(a+12);a+=20)imports.push(str(at(b.readUInt32LE(a+12))));
  const er=b.readUInt32LE(o+112);if(er){const a=at(er),count=b.readUInt32LE(a+24),list=at(b.readUInt32LE(a+32));for(let i=0;i<count;i++)exports.push(str(at(b.readUInt32LE(list+i*4))));}
  const system=/^(?:kernel32|advapi32|bcrypt|bcryptprimitives|ntdll|userenv|ws2_32|shell32|ole32|msvcrt|ucrtbase|api-ms-win-[a-z0-9-]+)\.dll$/i;
  assert.ok(imports.every(n=>system.test(n)),`non-system DLL dependency in ${name}: ${imports.filter(n=>!system.test(n))}`);
  const required=name.endsWith('ncnn.dll')?['ncnn_net_load_param_w','ncnn_net_load_model_w']:name.endsWith('runtime_v7.dll')?['zima_ncnn_create_json_v2','zima_ncnn_destroy_json_v2','zima_ncnn_load_json_v2','zima_ncnn_infer_json_v2']:[];
  for(const symbol of required)assert.ok(exports.includes(symbol),`missing native symbol ${symbol}`);
  results.push({name,bytes:b.length,machine:'x86-64',imports,requiredExports:required});
}
const report={platform:'win32-x64',nativeExecution:false,checks:results};
await writeFile(path.join(bundle,'pe-check.json'),JSON.stringify(report,null,2)+'\n');
console.log('Windows x64 PE/DLL checks passed: system-only imports and required OCR/UTF-16 exports. Native execution is pending.');
