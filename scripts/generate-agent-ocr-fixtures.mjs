import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
const output=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../docs/assets/agent-cli');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const lines=['星河科技采购单','订单编号 FILENS2026','客户名称：上海示例公司','项目名称：本地文档读取与识别','应付金额：12345.67 元','交付日期：2026年10月29日','备注：无需 Python，离线识别中文和 English。'];
for(const [name,font,blur] of [['invoice-zh',34,0],['invoice-blur',34,2.4],['invoice-small',13,0],['invoice-tiny',7,0],['invoice-heavy-blur',34,6.4]]){
 const text=lines.map(t=>`<p>${t}</p>`).join('');
 await page.setContent(`<html><meta charset="utf-8"><style>html,body{margin:0;background:#fff;color:#111}article{padding:60px;font: ${font}px/1.7 "PingFang SC",Arial,sans-serif;filter:blur(${blur}px)}p{margin:14px 0}</style><article>${text}</article></html>`);
 await page.screenshot({path:`${output}/${name}.png`});
}
await writeFile(`${output}/invoice-zh.expected.txt`,lines.join('\n')+'\n');
await browser.close();
console.log('Created five Chinese OCR evaluation images: clean, light/heavy blur, small/tiny text.');
