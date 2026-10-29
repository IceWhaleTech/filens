// End-user evaluation: invoke the actual CLI, preserve observed results, and
// measure OCR against known text. No private Python environment is used.
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const binaryIndex=process.argv.indexOf('--binary');
const binary=binaryIndex<0?path.join(root,'dist/filens'):path.resolve(process.argv[binaryIndex+1]);
const output=path.join(root,'dist/agent-evaluation');
const fixtures=path.join(output,'fixtures');
await mkdir(fixtures,{recursive:true});
const source='季度报告\n项目：本地文档读取\n预算：12345.67 元\n负责人：张三\nBudget 42\n';
for(const name of ['report.txt','季度 报告.txt','why notes.txt'])await writeFile(path.join(fixtures,name),source);
const ocrFixtures=path.join(root,'converter/rapidocr/testdata');
await copyFile(path.join(ocrFixtures,'scan.png'),path.join(fixtures,'invoice.png'));
await copyFile(path.join(ocrFixtures,'scan.pdf'),path.join(fixtures,'scan.pdf'));
await writeFile(path.join(fixtures,'embedded.docx'),zipSync({
 'word/document.xml':strToU8('<w:document xmlns:w="word" xmlns:a="drawing" xmlns:r="rels"><w:body><w:p><w:r><w:t>BEFORE 中文</w:t><a:blip r:embed="r1"/><w:t>AFTER</w:t></w:r></w:p></w:body></w:document>'),
 'word/_rels/document.xml.rels':strToU8('<Relationships><Relationship Id="r1" Target="media/scan.png"/></Relationships>'),
 'word/media/scan.png':await readFile(path.join(ocrFixtures,'scan-transparent.png'))
}));
const cases=[];
const add=(group,label,args,input)=>cases.push({group,label,args:Array.isArray(args)?args:[args],...(input===undefined?{}:{stdin:input})});
add('discovery','中文能力发现','你能做什么？以 JSON 输出');
add('discovery','格式发现','支持哪些格式？用 JSON 返回');
add('discovery','English discovery','what can you do as json');
add('discovery','English capability sentence','what are your capabilities in json');
add('discovery','可选 capacity 命令',['capacity','--json']);
add('discovery','能力问法同义变体','你能做哪些事情？');
add('discovery','OCR 能力疑问','你会 OCR 吗？');
add('discovery','混合发现与读取','你能做什么？顺便读取 "report.txt"，以 JSON 输出');
add('reading','中文读取含空格路径','请读取 "季度 报告.txt"，以纯文本输出');
add('reading','中文理解弯引号','帮我理解“季度 报告.txt”，用 JSON 返回');
add('reading','English read','read "report.txt" as json');
add('reading','English polite request','Please extract all text from "report.txt" in JSON');
add('reading','English contents','show me the contents of "report.txt"');
add('reading','路径独立 shell 参数',['understand','季度 报告.txt','--json']);
add('reading','只传路径',['report.txt','--json']);
add('reading','不加引号的紧邻读取','读取report.txt，以JSON输出');
add('reading','不加引号的客套变体','帮我读取report.txt，以JSON输出');
add('reading','不加引号的看一下','看一下report.txt');
add('reading','加引号的看一下','看一下 "report.txt"');
add('reading','文件名中的 why',['read','why notes.txt','--json']);
add('format','中文 JSON 格式','请用 JSON 格式读取 "report.txt"');
add('format','大写 JSON','Read "report.txt" as JSON');
add('format','输出 JSON 的另一种英语语序','read "report.txt" and output JSON');
add('format','自然语言要求 YAML','read "report.txt" as yaml');
add('format','自然语言要求 XML','读取 "report.txt"，以 XML 输出');
add('format','显式格式拒绝 YAML',['report.txt','--format','yaml']);
add('format','显式 flag 覆盖自然语言',['读取 "report.txt"，以纯文本输出','--json']);
add('format','自然语言格式冲突','read "report.txt" as json and as plain text');
add('structured','JSON stdin',[],JSON.stringify({operation:'understand',input:'report.txt'}));
add('structured','JSON 请求纯文本',[],JSON.stringify({operation:'read',input:'report.txt',format:'text'}));
add('structured','自然语言 stdin',[],'读取 "report.txt"，以 JSON 输出');
add('structured','JSON 未知字段',[],JSON.stringify({input:'report.txt',pages:'1-2'}));
add('structured','JSON 摘录请求',[],JSON.stringify({operation:'summarize',input:'report.txt',query:'预算',summaryChars:100}));
add('structured','JSON 非法 operation',[],JSON.stringify({operation:'nonexistent',input:'report.txt'}));
add('structured','JSON 非法 format',[],JSON.stringify({input:'report.txt',format:'xml'}));
add('summary','中文原文摘录','总结 "report.txt"，以 JSON 输出');
add('summary','英文原文摘录','summarize "report.txt" as json');
add('boundary','翻译','翻译 "report.txt" 成英文');
add('boundary','中文金额问答','"report.txt" 中预算是多少？');
add('boundary','英文明确问答','how many projects are in "report.txt"?');
add('boundary','另一种英文问答','what is the budget in "report.txt"?');
add('boundary','筛选金额','只列出 "report.txt" 中的金额，以 JSON 输出');
add('boundary','格式转换意图','把 "report.txt" 转成 PDF');
add('boundary','多个文件','read "report.txt" and "季度 报告.txt" as json');
add('boundary','目录遍历意图',['--input','.','--json']);
add('boundary','URL 输入','读取 "https://example.com/report.pdf"，以 JSON 输出');
add('boundary','没有文件路径','帮我读取文档，以 JSON 输出');
add('boundary','不存在的文件','读取 "missing.pdf"，以 JSON 输出');
add('ocr','自然语言调用 OCR','识别 "invoice.png" 中的文字，以 JSON 输出');
add('ocr','只读第一页的自然语言','只读取 "scan.pdf" 的第一页，以 JSON 输出');
add('ocr','扫描 PDF 完整读取','读取 "scan.pdf"，以 JSON 输出');
add('ocr','文档内嵌透明图片回调','理解 "embedded.docx"，以 JSON 输出');
add('ocr','关闭 OCR 保留已有文本',['understand','embedded.docx','--no-ocr','--json']);
for(const name of ['scan-rotated.png','scan-exif.jpg','scan-transparent.png'])add('ocr',name,[path.join(ocrFixtures,name),'--json']);
const expectedChinese=await readFile(path.join(root,'docs/assets/agent-cli/invoice-zh.expected.txt'),'utf8');
for(const name of ['invoice-zh','invoice-blur','invoice-small','invoice-tiny','invoice-heavy-blur']){
 add('quality',name,[path.join(root,`docs/assets/agent-cli/${name}.png`),'--json']);
 cases.at(-1).reference=expectedChinese;
}
for(const name of ['filens-aurora-guide.docx','filens-observatory.xlsx','filens-cosmic-atlas.pdf','filens-field-notes.pptx','legacy-project-workflow.doc','a.pages','a.numbers','filens-weekend.key']){
 const file=path.join(root,'apps/demo/public/samples',name);
 add('documents',name,[file,'--json']);
}
const results=[];
for(const test of cases){
 const result=await invoke(test);
 results.push(result);
 console.log(`${test.group}: ${test.label}: exit=${result.exit} format=${result.format} operation=${result.operation??'-'} ${result.elapsedMs}ms`);
}
const report={date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date()),platform:`${process.platform}-${process.arch}`,node:process.version,binary,method:'One process per request; sequential single run, including process startup, WASM compilation and OCR model loading. Synthetic text is not an accuracy benchmark corpus.',cases:results};
await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(`Saved ${results.length} real CLI observations to dist/agent-evaluation/report.json`);

async function invoke(test){
 const started=performance.now();
 return await new Promise((resolve,reject)=>{
  const child=spawn(binary,test.args,{cwd:fixtures,env:process.env,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';
  const timer=setTimeout(()=>child.kill('SIGKILL'),120000);
  child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
  child.on('error',error=>{clearTimeout(timer);reject(error);});
  child.on('close',(exit,signal)=>{
   clearTimeout(timer);
   let response;try{response=JSON.parse(stdout);}catch{}
   const text=response?.content?.text??(response?undefined:stdout);
   resolve({...test,exit,signal,format:response?'json':'text',operation:response?.operation,error:response?.error,ok:response?.ok,complete:response?.content?.complete,truncated:response?.content?.truncated,blocks:response?.content?.document?.blocks?.length,elapsedMs:Math.round(performance.now()-started),characters:text?[...text].length:0,text,stderr,...(response?.capacity?{ocr:response.capacity.ocr,formats:response.capacity.formats.length}:{}),...(test.reference&&typeof text==='string'?{normalizedCER:characterError(test.reference,text),invoiceNumberCorrect:text.includes('FILENS2026'),amountCorrect:text.includes('12345.67')}:{} )});
  });
  child.stdin.end(test.stdin??'');
 });
}
function characterError(expected,actual){
 const normalize=s=>Array.from(s.normalize('NFKC').replace(/[\s\p{P}]/gu,''));
 const a=normalize(expected),b=normalize(actual);let previous=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));previous=next;
 }
 return Number((previous[b.length]/Math.max(a.length,1)).toFixed(4));
}
