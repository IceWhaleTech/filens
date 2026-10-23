import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.resolve(root, process.env.FILENS_OCCT_WORKDIR || 'tmp/occt-wasm');
const vendor = path.resolve(root, process.env.FILENS_OCCT_BUILD || 'packages/model3d/vendor/occt-import-js');
const release = await readFile(path.join(vendor, 'occt-import-js.wasm'));
const named = await readFile(path.join(work, 'profile/occt-import-js.wasm'));
const shipped = parseWasm(release), profile = parseWasm(named);
assert(profile.names.size > 0, 'Rebuild with profiling function names first');
// Names never ship. Every actual code/data/type/import section must be identical
// to the published artifact before we can attribute its function body bytes.
const executable = parsed => parsed.sections.filter(section => section.id !== 0);
assert.deepEqual(executable(profile).map(section => section.bytes), executable(shipped).map(section => section.bytes),
  'The profile and release executable sections differ; rebuild both together');

const categories = new Map();
const functions = profile.functions.map(fn => ({ ...fn, category: classify(fn.name) }));
assert(!functions.some(fn => /Message_PrinterOStream::|OSD_File::|basic_filebuf</.test(fn.name)),
  'Unused native console/file IO must not ship');
const loaderBytes = await readFile(path.join(vendor, 'occt-import-js.js'));
assert(!/var FS=|FS\.createDataFile|FS\.mount/.test(loaderBytes.toString('utf8')),
  'The memory-stream preview must not retain the JS virtual filesystem');
for (const fn of functions) categories.set(fn.category, (categories.get(fn.category) || 0) + fn.size);
const tables = await findTables(profile.data);
assert(!tables.some(table => table.name === 'VBMatrix'), 'The replaced Bernstein table must not ship');
assert(!tables.some(table => /^(?:BBMatrix|IMatrix|IBT|WeightsDB0?_C[012]|TransMatrix_C[012])$/.test(table.name)), 'Replaced full matrices and Jacobi tables must not ship');
const bernsteinCheck = JSON.parse(await readFile(path.join(work, 'bernstein-check/result.json'), 'utf8'));
const numericCheck = JSON.parse(await readFile(path.join(work, 'numeric-check/result.json'), 'utf8'));
const strtodCheck = JSON.parse(await readFile(path.join(work, 'strtod-check/result.json'), 'utf8'));
const numericLayout = JSON.parse(await readFile(path.join(work, 'numeric-layout.json'), 'utf8'));
const keywordLayout = JSON.parse(await readFile(path.join(work, 'keyword-layout.json'), 'utf8'));
const keywordCheck = JSON.parse(await readFile(path.join(work, 'keyword-check/result.json'), 'utf8'));
assert.equal(bernsteinCheck.compared, 105000);
assert(bernsteinCheck.maximumAbsoluteError <= 2e-13 && bernsteinCheck.maximumRelativeError <= 2e-11);
assert(keywordCheck.exact && keywordCheck.compared > 28000 && keywordCheck.complexCompared > 16000);
assert.equal(keywordCheck.lastAliasBinding, 483);
const tableBytes = tables.reduce((sum, table) => sum + table.size, 0);
categories.set('几何计算的预计算数值表', tableBytes);
const dataBytes = profile.data.reduce((sum, data) => sum + data.length, 0);
categories.set('其他静态数据（字符串、虚表等）', dataBytes - tableBytes);
categories.set('WASM 结构与段开销', release.length - [...categories.values()].reduce((sum, size) => sum + size, 0));
const rows = [...categories].map(([name, bytes]) => ({ name, bytes, percent: +(bytes / release.length * 100).toFixed(2) }))
  .sort((a, b) => b.bytes - a.bytes);
const linkMap = await readFile(path.join(work, 'build/occt-import-js.map'), 'utf8');
const libraries = [...new Set([...linkMap.matchAll(/\/([^/\s()]+\.a)\(/g)].map(match => match[1]))].sort();
const report = {
  unit: 'bytes',
  sha256: createHash('sha256').update(release).digest('hex'),
  wasm: measure(release),
  loader: measure(loaderBytes),
  functionCount: functions.length,
  rows,
  sections: shipped.sections.map(section => ({ id: section.id, name: section.name, bytes: section.bytes.length })),
  tables,
  bernsteinReplacement: {
    removedTable: 'VBMatrix',
    originalMemoryBytes: 840000,
    strategy: 'Runtime de Casteljau recurrence at existing OCCT Gauss points; all degrees 1..25 and rules 1..24 retained.',
    validation: bernsteinCheck,
    previousTableBuild: { raw: 3911653, gzip: 1781978, brotli: 1471439 }
  },
  numericReplacements: {
    previousBuild: { raw: 3058441, gzip: 1251337, brotli: 1002588 },
    symmetricTables: numericLayout,
    coefficientValidation: numericCheck,
    strtodValidation: strtodCheck,
    removedNativeMessageBytes: 36190
  },
  ioPruning: {
    previousWasm: { raw: 2757687, gzip: 1063137, brotli: 827075 },
    previousLoader: { raw: 95402, gzip: 26132, brotli: 23054 },
    resultWasm: { raw: 2733713, gzip: 1050550, brotli: 818303 },
    resultLoader: { raw: 45276, gzip: 13407, brotli: 12094 },
    virtualFilesystem: false,
    externalResourceFiles: false,
    nativeDiagnosticFormatting: false,
    strategy: 'Memory-stream STEP input, programmatic resource defaults, no native diagnostic printer, lazy compatibility stream, and Emscripten FILESYSTEM=0. Checks, exceptions and status flags retained.'
  },
  keywordReplacement: {
    previousWasm: { raw: 2733713, gzip: 1050550, brotli: 818303 },
    layout: keywordLayout,
    validation: keywordCheck,
    strategy: 'Immutable sorted full-name/alias tables, lazy canonical-name cache, and compact exact complex-entity rules over sorted spelling ranks. Original last-alias-binding and first-complex-match behavior retained.'
  },
  linkedSystemArchives: libraries,
  largestFunctions: functions.sort((a, b) => b.size - a.size).slice(0, 30)
    .map(({ name, size, category }) => ({ name, bytes: size, category })),
  method: 'Exact optimized function-body bytes and static data; symbols classified by owning OCCT module. Inlined code belongs to its enclosing function. Code/data sections match the shipped WASM byte for byte. gzip/Brotli ratios are not additive by module.'
};
await writeFile(path.join(root, 'docs/assets/occt-wasm-breakdown.json'), `${JSON.stringify(report, null, 2)}\n`);
const kib = bytes => (bytes / 1024).toFixed(1);
const markdown = `# STEP 预览 WASM 体积剖析

当前产物：**${kib(release.length)} KiB 原始 / ${kib(report.wasm.gzip)} KiB gzip / ${kib(report.wasm.brotli)} KiB Brotli**。
独立 JS 加载器为 ${kib(report.loader.raw)} KiB 原始 / ${kib(report.loader.brotli)} KiB Brotli，首次打开 STEP 时按需加载。

## 最终产物的组成

| 部分 | KiB | 占整个 WASM |
| --- | ---: | ---: |
${rows.map(row => `| ${row.name} | ${kib(row.bytes)} | ${row.percent.toFixed(2)}% |`).join('\n')}

这是最终优化产物中 ${functions.length} 个函数体及数据段的实际字节数，包含函数长度编码。
带符号分析产物与发布 WASM 的所有非自定义段逐字节一致，分析符号不发布。
函数按符号所属模块归类；LTO 跨模块内联的代码计入承载它的函数，因此不能解释为源码行数占比。
压缩使用 gzip level 9 / Brotli quality 11；模块之间共享压缩字典，不能将原始占比当作压缩占比。

## 大块数据和外部依赖

| 保留的数值表 | 来源 | KiB |
| --- | --- | ---: |
${tables.map(table => `| ${table.name} | OCCT / ${table.module} | ${kib(table.size)} |`).join('\n')}

原来最大的 \`VBMatrix\` 表占 840,000 字节，存储 Bernstein 基函数在高斯采样点上的值，现已改成运行时 de Casteljau 递推，复用已有高斯采样点。
全部 1–25 次曲线、1–24 点高斯规则保留。实际 C++ 编译为 WASM 后对照原表全部 ${bernsteinCheck.compared.toLocaleString('en-US')} 个系数，最大绝对误差 ${bernsteinCheck.maximumAbsoluteError.toExponential(3)}，最大相对误差 ${bernsteinCheck.maximumRelativeError.toExponential(3)}；另检查端点和基函数之和为 1。

| 表替换前后 | 原始 KiB | gzip KiB | Brotli KiB |
| --- | ---: | ---: | ---: |
| 保留预计算表 | 3820.0 | 1740.2 | 1437.0 |
| Bernstein 运行时递推 | 2986.8 | 1222.0 | 979.1 |
| 数值表与十进制解析精简 | 2693.1 | 1038.2 | 807.7 |
| 内存输入与原生 I/O 裁剪 | ${kib(report.ioPruning.resultWasm.raw)} | ${kib(report.ioPruning.resultWasm.gzip)} | ${kib(report.ioPruning.resultWasm.brotli)} |
| STEP 名称表与复合类型规则精简 | ${kib(report.wasm.raw)} | ${kib(report.wasm.gzip)} | ${kib(report.wasm.brotli)} |

递推每次构造拟合矩阵时增加少量乘加运算，复杂度为 O(采样点数 × 次数²)，无需新增依赖或缓存大表。
55 个 STEP 样例的 165 次导入已通过世界坐标三角形、法线、实例位置及单位转换对比。

数值与消息数据的精简包括：

- Bernstein Gram 矩阵 \`BBMatrix\`：49,600 字节改成组合数公式。中间整数不超过 2⁵³；全部 ${numericCheck.gram.compared.toLocaleString('en-US')} 个系数与原表完全一致，无需数值求逆。
- 逆矩阵和切向约束矩阵：利用转置和中心对称性，79,960 字节改为 22,448 字节。全部 ${numericCheck.packed.compared.toLocaleString('en-US')} 个系数与原表逐个双精度值一致。
- Jacobi 积分权重：约 108 KiB 改成运行时递推，复用现有 Gauss 节点和权重。全部 ${numericCheck.jacobi.compared.toLocaleString('en-US')} 个系数校验，最大绝对误差 ${numericCheck.jacobi.maximumAbsoluteError.toExponential(3)}。靠近多项式零点时相对误差会放大，校验采用 2e-14 的绝对误差上限。
- Jacobi 换基矩阵：23,808 字节改成多项式系数递推。全部 ${numericCheck.transform.compared.toLocaleString('en-US')} 个系数校验，最大相对误差 ${numericCheck.transform.maximumRelativeError.toExponential(3)}，结构零项保持为零。
- 十进制字符串解析：复用已链接的 C 运行库 \`strtod_l\` 和显式 C locale，移除 OCCT 的第二套大整数转换实现及 10,672 字节幂表。${strtodCheck.compared.toLocaleString('en-US')} 个随机、长数字、次正规数、舍入边界、无效输入和结束指针测试全部通过，结果与原实现一致。
- 原生诊断消息目录：移除 36,190 字节英文消息文本及资源加载入口。JS 预览仅返回成功状态与几何数据；解析检查、异常、形状修复状态和前端错误提示保留。

Jacobi 权重按采样点计算；换基矩阵按调用生成，最大约 30 KiB 临时内存，用后释放。没有新增第三方依赖、降低曲线阶数或运行时缓存大表。
端点约束矩阵 \`IBP\` 保留原始值，不对高条件数矩阵重新求逆。

此前的 I/O 裁剪停用了 \`Message_Messenger\` 的原生打印器和流式日志格式化；旧诊断接口需要 ostream 时才创建兼容缓冲，消息参数中的表达式仍会执行。STEP 只接受适配器提供的内存流，移除原生路径导入。资源管理器保留配置映射和程序内设置，使用已有内置默认值，移除外部资源配置文件的查找和解析。最后通过 \`-sFILESYSTEM=0\` 去掉 Emscripten 虚拟文件系统。

| I/O 裁剪阶段变化 | 原始 KiB | gzip KiB | Brotli KiB |
| --- | ---: | ---: | ---: |
| WASM 减少 | ${kib(report.ioPruning.previousWasm.raw - report.ioPruning.resultWasm.raw)} | ${kib(report.ioPruning.previousWasm.gzip - report.ioPruning.resultWasm.gzip)} | ${kib(report.ioPruning.previousWasm.brotli - report.ioPruning.resultWasm.brotli)} |
| JS 加载器减少 | ${kib(report.ioPruning.previousLoader.raw - report.ioPruning.resultLoader.raw)} | ${kib(report.ioPruning.previousLoader.gzip - report.ioPruning.resultLoader.gzip)} | ${kib(report.ioPruning.previousLoader.brotli - report.ioPruning.resultLoader.brotli)} |

没有新增下载解压步骤、外部依赖或几何近似。解析检查、异常和修复状态保留；完整 55 文件、165 次导入的几何对比继续通过。额外的重复优化和相似函数合并实验仅节省几十至几百字节压缩体积，未增加到构建流程。

本轮替换 STEP 协议中的启动注册表和复合类型识别：

- ${keywordLayout.globalStringObjects} 个全局字符串对象及两张动态映射，改为不可变的有序表和二分查找，保留 ${keywordLayout.fullNameEntries} 个完整名称、${keywordLayout.shortNameEntries} 个短名。原来的重复别名 \`CMRPIT\` 仍以后一次绑定为准，映射到 483。
- \`StepType\` 以小整数索引取名，保留返回引用的生命周期。${keywordLayout.cachedTypeNames} 个缓存槽首次使用时构造，具体名称按需填充；OCCT 空字符串自身仍有少量分配。
- 复合实体的 ${keywordLayout.complexComparisons} 次重复字符串比较，改为 ${keywordLayout.complexRules} 条完整规则和整数比较；短名先按原规则展开，再对最多 8 个整数排序。自动解析原条件树，保留首条匹配以及拒绝规则的优先级，不增加可识别的实体类型。
- 实际生成的 C++ 表和识别函数编译为 WASM，与固定版本的原注册方法、类型名称 switch、复合实体识别及反向配方逐项对照：${keywordCheck.compared.toLocaleString('en-US')} 次名称查找、${keywordCheck.namesCompared} 个类型编号和 ${keywordCheck.complexCompared.toLocaleString('en-US')} 组复合类型全部一致，覆盖乱序、混合短名、缺项、未知项和内嵌 NUL。

| 名称与规则表阶段变化 | 原始 KiB | gzip KiB | Brotli KiB |
| --- | ---: | ---: | ---: |
| WASM 减少 | ${kib(report.keywordReplacement.previousWasm.raw - report.wasm.raw)} | ${kib(report.keywordReplacement.previousWasm.gzip - report.wasm.gzip)} | ${kib(report.keywordReplacement.previousWasm.brotli - report.wasm.brotli)} |

这部分原本包含大量容易压缩的重复代码，因此压缩后的节省小于原始二进制的节省。几何计算、修复、法线、实例位置与单位转换保持原有行为。

链接映射中实际出现的系统归档：${libraries.map(library => `\`${library}\``).join('、')}。
它们提供 C/C++、异常处理、JS 绑定及内存分配。Three.js 在独立 JavaScript 分包中，不在这个 WASM 内。
此构建没有链接 FreeType、FreeImage、OpenGL、TBB、zlib 或其他独立的图形/图像库。
OCCT 的文档持久化、显示模块、IGES/BREP 入口及导出模块已从源文件清单排除；Delabella 备用网格算法也不再由工厂引用。

此前剖析还发现并移除了原链接中 389,152 字节的 Shift-JIS、GB2312、GBK、Big5 表，以及未使用的交互式选择器和参数编辑器。
文本仅保留 UTF-8/ASCII 和 STEP Unicode 转义处理。颜色、名称、文档属性、面属性和装配树不再输出；零件实例及位置、曲面、网格法线和单位转换保留。
仅含外部文件引用而没有内嵌面片的文件会报告无法预览，不会生成空白模型。

## 复现

\`\`\`sh
EMCMAKE=/path/to/emsdk/upstream/emscripten/emcmake npm run build:occt-wasm
npm run report:occt-wasm
npm run test:occt-wasm
\`\`\`

Emscripten 版本固定为 3.1.61。\`FILENS_OCCT_WORKDIR\` 可指定同一个源码、对象和分析缓存目录。
分析结果包含发布 WASM 的 SHA-256、各段字节数及最大的 30 个函数：[完整数据](assets/occt-wasm-breakdown.json)。
当前发布 SHA-256：\`${report.sha256}\`。
`;
await writeFile(path.join(root, 'docs/occt-wasm-breakdown.md'), markdown);
console.table(rows);
console.log(`Wrote docs/occt-wasm-breakdown.md; executable sections verified against release (${report.sha256}).`);

function measure(bytes) {
  return { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length };
}

function classify(name) {
  if (/^(?:emscripten::|ReadStepFile|Preview|OcctFace|VectorBuffer|ImportParams|LinearUnitToLengthUnit|TriangulateShape|Face::|embind|__embind|_emval|__emval)/.test(name)) return '预览适配与 JS 绑定';
  if (/^(?:VBernstein|FilensBernsteinValues)/.test(name)) return '曲面、曲线、拓扑与数值计算';
  if (/(?:^| )Filens(?:GramMatrix|PackedMatrix|Jacobi)/.test(name)) return '曲面、曲线、拓扑与数值计算';
  if (/(?:^| )FilensStep/.test(name)) return 'STEP 解析、协议与几何转换';
  if (/^(?:std::|__cxx|__cxa|__gxx|__clang|__wasm|__original|__libc|_Unwind|_GLOBAL__sub_I_.*(?:iostream|exception)|operator |__Z|\$)/.test(name)
      || !/[A-Z][A-Za-z0-9]+(?:::|_)/.test(name) && !/^(?:math|gp|gce|step|recfile|yy)/.test(name)) return 'C/C++ 与 Emscripten 运行时';

  if (/(?:XCAF|TDF_|TData|TDocStd|TNaming|BinXCAF|BinM|CDM_|CDF_|PCDM_)/.test(name)) return '文档模块残留';
  if (/^(?:NCollection|TCollection|TCol|Standard|OSD|Resource|Message|Quantity|Units|opencascade::|Storage|FSD|Plugin)/.test(name)
      || /^_GLOBAL__sub_I_/.test(name)) return 'OCCT 基础设施、容器与类型系统';
  if (/^(?:RWStep|RWHeader|Step|STEP|Header|step|recfile|yy)/.test(name)) return 'STEP 解析、协议与几何转换';
  if (/^(?:Interface|IFSelect|XSControl|Transfer|MoniTool|LibCtl|APIHeader|STEPEdit)/.test(name)) return '导入会话、实体图与传递框架';
  if (/^(?:Shape|XSAlgo)/.test(name)) return '形状修复与几何检查';
  if (/^(?:BRepMesh|IMesh|Poly|BVH)/.test(name)) return '三角网格生成';
  if (/^(?:BRep|Topo|TopAbs|TopExp|TopLoc|TopTools|Bnd|Geom|GCE|GCP|GC_|Gcc|gp|gce|math|PLib|BSpl|Convert|Adaptor|Approx|AdvApprox|AdvApp|AppCont|AppDef|AppPar|AppBlend|CPnts|CSLib|ElCLib|ElSLib|Extrema|FEm|Int|Proj|GProp|Local|LProp|Precision|Law|GProp|Hatch|Sweep|GeomAbs|Contap|Bisector|Plate|MAT|TopClass|TopOpe|TopTrans)/.test(name)) return '曲面、曲线、拓扑与数值计算';
  return '其他函数（未按符号归类）';
}

async function findTables(segments) {
  const found = [];
  // Binaryen splits active segments around long zero runs. Reconstruct their
  // memory image to recognize tables, but count only bytes actually emitted.
  const memory = Buffer.alloc(Math.max(...segments.map(segment => segment.address + segment.length)));
  for (const segment of segments) segment.copy(memory, segment.address);
  const directory = path.join(work, 'source/occt/src/AppCont');
  const files = (await readdir(directory)).filter(file => /^(?:AppCont_ContMatrices.*\.cxx|filens-.*\.pxx)$/.test(file)).map(file => path.join(directory, file));
  files.push(path.join(work, 'source/occt/src/PLib/PLib_JacobiPolynomial_Data.pxx'), path.join(work, 'source/occt/src/math/math.cxx'));
  for (const file of ['AppCont_ContMatrices.cxx', 'AppCont_ContMatrices_2.cxx', 'AppCont_ContMatrices_3.cxx']) files.push(path.join(work, 'numeric-original', file));
  // Also search for the removed original table in the actual memory image.
  files.push(path.join(work, 'bernstein-original.cxx'));
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/static\s+const\s+(?:Standard_Real|double)\s+(\w+)(?:\[\s*\d*\s*\])+\s*=\s*\{([\s\S]*?)\};/g)) {
      const values = match[2].replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').replace(/[{}]/g, '').split(',').map(value => value.trim()).filter(Boolean).map(numericConstant);
      if (!values.length || values.some(value => !Number.isFinite(value))) continue;
      const bytes = Buffer.alloc(values.length * 8);
      values.forEach((value, index) => bytes.writeDoubleLE(value, index * 8));
      const address = memory.indexOf(bytes);
      if (address !== -1) {
        const size = segments.reduce((sum, segment) => sum + Math.max(0,
          Math.min(segment.address + segment.length, address + bytes.length) - Math.max(segment.address, address)), 0);
        found.push({ name: match[1], module: path.basename(path.dirname(file)), size, memoryBytes: bytes.length });
      }
    }
  }
  return found.sort((a, b) => b.size - a.size);
}

// Some pinned OCCT initializers contain additive constant expressions rather
// than single literals. Evaluate only numeric +/- expressions, without eval.
function numericConstant(expression) {
  const number = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';
  const compact = expression.replace(/\s+/g, '');
  if (!new RegExp(`^(?:${number})+$`).test(compact)) return NaN;
  return [...compact.matchAll(new RegExp(number, 'g'))].reduce((sum, token) => sum + Number(token[0]), 0);
}

function parseWasm(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x6d736100, 'Expected WASM magic');
  let offset = 8, importedFunctions = 0;
  const sections = [], names = new Map(), functions = [], data = [];
  const uleb = () => { let value = 0, shift = 0, byte; do { byte = bytes[offset++]; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128); return value; };
  const string = () => { const length = uleb(); const value = bytes.toString('utf8', offset, offset + length); offset += length; return value; };
  const limits = () => { const flags = uleb(); uleb(); if (flags & 1) uleb(); };
  const sectionNames = ['custom', 'type', 'import', 'function', 'table', 'memory', 'global', 'export', 'start', 'element', 'code', 'data', 'data count', 'tag'];
  while (offset < bytes.length) {
    const start = offset, id = bytes[offset++], length = uleb(), end = offset + length;
    const section = { id, name: sectionNames[id] || `section ${id}`, bytes: bytes.subarray(start, end) };
    sections.push(section);
    if (id === 0) {
      section.name = string();
      if (section.name === 'name') {
        while (offset < end) {
          const kind = bytes[offset++], size = uleb(), next = offset + size;
          if (kind === 1) { const count = uleb(); for (let i = 0; i < count; i++) { const index = uleb(); names.set(index, string()); } }
          offset = next;
        }
      }
    } else if (id === 2) {
      const count = uleb();
      for (let i = 0; i < count; i++) {
        string(); string();
        const kind = bytes[offset++];
        if (kind === 0) { importedFunctions++; uleb(); }
        else if (kind === 1) { offset++; limits(); }
        else if (kind === 2) limits();
        else if (kind === 3) offset += 2;
        else if (kind === 4) { uleb(); uleb(); }
        else throw new Error(`Unsupported import kind ${kind}`);
      }
    } else if (id === 10) {
      const count = uleb();
      for (let i = 0; i < count; i++) { const start = offset, length = uleb(); offset += length; functions.push({ index: importedFunctions + i, size: offset - start }); }
    } else if (id === 11) {
      const count = uleb();
      for (let i = 0; i < count; i++) {
        const flags = uleb();
        if (flags === 2) uleb();
        assert.notEqual(flags, 1, 'Expected active data segments');
        assert.equal(bytes[offset++], 0x41, 'Expected i32.const data offset');
        const address = uleb();
        assert.equal(bytes[offset++], 0x0b);
        const length = uleb(), segment = bytes.subarray(offset, offset + length);
        segment.address = address;
        data.push(segment); offset += length;
      }
    }
    offset = end;
  }
  for (const fn of functions) fn.name = names.get(fn.index) || `function ${fn.index}`;
  return { sections, names, functions, data };
}
