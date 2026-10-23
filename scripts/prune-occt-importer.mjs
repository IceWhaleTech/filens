import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// OCCT controllers register both readers and writers, even in an import-only
// application. Remove those registrations as well as virtual export methods;
// otherwise their vtables keep TopoDSToStep and editing machinery alive in LTO.
export async function pruneOcctImporter(source) {
  const controllerFile = path.join(source, 'STEPControl/STEPControl_Controller.cxx');
  let controller = await readFile(controllerFile, 'utf8');
  controller = replaceOnce(controller,
    /  Handle\(STEPControl_ActorWrite\) ActWrite = new STEPControl_ActorWrite;\s*ActWrite->SetGroupMode[^;]*;\s*myAdaptorWrite = ActWrite;/g,
    '  // Filens exposes no STEP export actor.');
  controller = replaceBody(controller, 'STEPControl_Controller::TransferWriteShape', 'return IFSelect_RetError;');
  // The two blocks are session editors in the constructor and Customise().
  const editors = /  Handle\(APIHeaderSection_EditHeader\) edhead = new APIHeaderSection_EditHeader;[\s\S]*?[^\n]*"step-SDR-data"[^\n]*;/g;
  if ([...controller.matchAll(editors)].length !== 2) throw new Error('Unexpected STEP session editors');
  controller = controller.replace(editors, '  // Filens exposes no document editing session.');
  await writeFile(controllerFile, controller);

  const libraryFile = path.join(source, 'StepSelect/StepSelect_WorkLibrary.cxx');
  let library = await readFile(libraryFile, 'utf8');
  for (const method of ['WriteFile', 'CopyModel']) {
    library = replaceBody(library, `StepSelect_WorkLibrary::${method}`, 'return Standard_False;');
  }
  library = replaceBody(library, 'StepSelect_WorkLibrary::DumpEntity', '// STEP serialization is not exposed.');
  await writeFile(libraryFile, library);
  await pruneShapeOperators(source);
  await pruneNonStepAlgorithms(source);
}

export async function pruneNonStepAlgorithms(source) {
  const file = path.join(source, 'ShapeAlgo/ShapeAlgo_AlgoContainer.cxx');
  let original = await readFile(file, 'utf8');
  // These virtual methods are used only by IGES translation or by exporters.
  // Keep C0ShapeToC1Shape and ConvertToPeriodic, which STEP readers do call.
  for (const [method, count] of [
    ['ConnectNextWire', 1], ['ApproxBSplineCurve', 2],
    ['C0BSplineToSequenceOfC1BSplineCurve', 2], ['ConvertSurfaceToBSpline', 1],
    ['HomoWires', 1], ['OuterWire', 1], ['GetFaceUVBounds', 1], ['ConvertCurveToBSpline', 1]
  ]) original = replaceBody(original, `ShapeAlgo_AlgoContainer::${method}`, '__builtin_trap();', count);
  await writeFile(file, original);
}

export async function pruneShapeOperators(source) {
  const file = path.join(source, 'ShapeProcess/ShapeProcess_OperLibrary.cxx');
  const original = await readFile(file, 'utf8');
  let removed = 0;
  const patched = original.replace(/^.*ShapeProcess::RegisterOperator\s*\(\s*"([^"]+)"[^\n]*\n/gm, (line, name) => {
    // XSTEPResource/STEP uses only FixShape on import. The JS adapter never
    // exposes operator/resource customization or export preparation sequences.
    if (name === 'FixShape') return line;
    removed++;
    return '';
  });
  if (removed !== 17) throw new Error(`Expected 17 unused shape operators, got ${removed}`);
  await writeFile(file, patched);
}

// These entity families describe simulation, joints/motion, or PMI, none of
// which the preview adapter returns. Unknown STEP records remain parseable;
// retain every geometry, topology, unit, assembly, and presentation entity.
export async function pruneMeshProtocols(source) {
  const protocolFile = path.join(source, 'StepAP214/StepAP214_Protocol.cxx');
  let protocol = await readFile(protocolFile, 'utf8');
  const excluded = new Set();
  protocol = protocol.replace(/types\.Bind\s*\(STANDARD_TYPE\((Step(?:Element|FEA|Kinematics|DimTol)_\w+)\)\s*,\s*(\d+)\s*\);/g, (_line, _name, id) => {
    excluded.add(Number(id));
    return '// Entity omitted by the Filens mesh-only protocol.';
  });
  if (excluded.size !== 194) throw new Error(`Expected 194 non-preview entity types, got ${excluded.size}`);
  await writeFile(protocolFile, protocol);
  for (const name of ['ReadWrite', 'General']) {
    const file = path.join(source, `RWStepAP214/RWStepAP214_${name}Module.cxx`);
    let original = await readFile(file, 'utf8');
    original = pruneCases(original, excluded);
    if (name === 'ReadWrite') {
      original = original.replace(/^.*(?:typenums|typeshor)\.Bind\s*\([^\n]*,\s*(\d+)\s*\);[^\n]*\n/gm,
        (line, id) => excluded.has(Number(id)) ? '' : line);
      const start = original.indexOf('Standard_Integer RWStepAP214_ReadWriteModule::CaseStep');
      const end = original.indexOf('Standard_Boolean RWStepAP214_ReadWriteModule::IsComplex', start);
      if (start < 0 || end < 0) throw new Error('Unexpected STEP complex entity recognizer');
      const recognizer = original.slice(start, end).replace(/\breturn\s+(\d+)\s*;/g,
        (value, id) => excluded.has(Number(id)) ? 'return 0;' : value);
      original = original.slice(0, start) + recognizer + original.slice(end);
    }
    await writeFile(file, original);
  }
  console.log(`Excluded ${excluded.size} simulation, kinematics, and PMI entity types.`);
}

// This adapter returns only world-space triangles and normals. Keep units,
// product/representation relationships, and geometric tessellation entities;
// discard styling and administrative records without creating a CAF document.
export async function prunePreviewProtocols(source) {
  const protocolFile = path.join(source, 'StepAP214/StepAP214_Protocol.cxx');
  let protocol = await readFile(protocolFile, 'utf8');
  const excluded = new Set();
  const administrative = /^(?:Address|Approval|CalendarDate|CoordinatedUniversalTimeOffset|Date|LocalTime|OrdinalDate|Organization|OrganizationalAddress|Person|SecurityClassification|WeekOfYearAndDayDate|Action|Certification|Contract|Effectivity|ProductDefinitionEffectivity|ExternalIdentificationAssignment|Identification|NameAssignment|GeneralProperty|Group)/;
  protocol = protocol.replace(/^([ \t]*)types\.Bind\s*\(STANDARD_TYPE\((Step\w+)\)\s*,\s*(\d+)\s*\);/gm, (line, indent, name, id) => {
    const omit = /^StepAP(?:203|214|242)_/.test(name)
      || (/^StepVisual_/.test(name) && !/^StepVisual_(?:Tessellated(?:Item|GeometricSet|CurveSet)|CoordinatesList)$/.test(name))
      || (name.startsWith('StepBasic_') && administrative.test(name.slice('StepBasic_'.length)))
      || /^StepRepr_(?:Material|StructuralResponse|DataEnvironment)/.test(name)
      || /^StepShape_(?:LimitsAndFits|ToleranceValue|MeasureQualification|PlusMinusTolerance|PrecisionQualifier|TypeQualifier|QualifiedRepresentationItem|MeasureRepresentationItemAndQualifiedRepresentationItem|ValueFormatTypeQualifier)$/.test(name);
    if (!omit) return line;
    excluded.add(Number(id));
    return `${indent}// Non-geometric entity omitted by the Filens preview protocol.`;
  });
  if (excluded.size !== 184) throw new Error(`Expected 184 styling/administrative entity types, got ${excluded.size}`);
  await writeFile(protocolFile, protocol);
  for (const name of ['ReadWrite', 'General']) {
    const file = path.join(source, `RWStepAP214/RWStepAP214_${name}Module.cxx`);
    let original = pruneCases(await readFile(file, 'utf8'), excluded);
    if (name === 'ReadWrite') {
      original = original.replace(/^.*(?:typenums|typeshor)\.Bind\s*\([^\n]*,\s*(\d+)\s*\);[^\n]*\n/gm,
        (line, id) => excluded.has(Number(id)) ? '' : line);
      const start = original.indexOf('Standard_Integer RWStepAP214_ReadWriteModule::CaseStep');
      const end = original.indexOf('Standard_Boolean RWStepAP214_ReadWriteModule::IsComplex', start);
      if (start < 0 || end < 0) throw new Error('Unexpected STEP complex entity recognizer');
      original = original.slice(0, start) + original.slice(start, end).replace(/\breturn\s+(\d+)\s*;/g,
        (value, id) => excluded.has(Number(id)) ? 'return 0;' : value) + original.slice(end);
    }
    await writeFile(file, original);
  }
  console.log(`Excluded ${excluded.size} styling, annotation, and administrative entity types.`);
}

export async function prunePreviewMesher(source) {
  const file = path.join(source, 'BRepMesh/BRepMesh_Context.cxx');
  let original = await readFile(file, 'utf8');
  original = replaceBody(original, 'BRepMesh_Context::BRepMesh_Context', `
  // The browser preview uses OCCT's default Watson mesher exclusively.
  Handle (IMeshTools_MeshAlgoFactory) aAlgoFactory = new BRepMesh_MeshAlgoFactory();
  SetModelBuilder (new BRepMesh_ModelBuilder);
  SetEdgeDiscret (new BRepMesh_EdgeDiscret);
  SetModelHealer (new BRepMesh_ModelHealer);
  SetPreProcessor (new BRepMesh_ModelPreProcessor);
  SetFaceDiscret (new BRepMesh_FaceDiscret (aAlgoFactory));
  SetPostProcessor (new BRepMesh_ModelPostProcessor);`);
  await writeFile(file, original);
}

// Native interactive sessions install selection tools, statistics, dispatchers,
// and parameter editors. STEPControl_Reader uses direct transfer APIs instead.
export async function prunePreviewSessions(source) {
  const file = path.join(source, 'STEPControl/STEPControl_Controller.cxx');
  let original = await readFile(file, 'utf8');
  original = replaceOnce(original,
    /  \/\/   ---  SELECTIONS, SIGNATURES, COMPTEURS, EDITEURS[\s\S]*?\n}\n/g,
    '  // Interactive selection and editing tools are not preview APIs.\n}\n');
  original = replaceBody(original, 'STEPControl_Controller::Customise',
    'XSControl_Controller::Customise(WS);');
  await writeFile(file, original);
  const baseFile = path.join(source, 'XSControl/XSControl_Controller.cxx');
  const base = replaceBody(await readFile(baseFile, 'utf8'), 'XSControl_Controller::Customise',
    'WS->SetParams(myParams, myParamUses);');
  await writeFile(baseFile, base);
}

// Shape previews do not expose text. Preserve UTF-8 and ASCII (including STEP
// escape processing in StepReaderData), but omit legacy name-encoding tables.
export async function prunePreviewEncodings(source) {
  const file = path.join(source, 'Resource/Resource_Unicode.cxx');
  const original = replaceBody(await readFile(file, 'utf8'), 'Resource_Unicode::ConvertFormatToUnicode', `
  theToStr = TCollection_ExtendedString(theFromStr,
    theFormat == Resource_FormatType_UTF8 || theFormat == Resource_FormatType_SystemLocale);`);
  await writeFile(file, original);
}

// The JS preview API exposes a success flag and geometry, not OCCT's native
// localized diagnostic catalog. Keep parser checks, status flags and exceptions.
export async function prunePreviewMessages(source) {
  const shapeFile = path.join(source, 'ShapeExtend/ShapeExtend.cxx');
  const shape = replaceBody(await readFile(shapeFile, 'utf8'), 'ShapeExtend::Init',
    '// Localized native diagnostic catalogs are not part of the preview API.');
  await writeFile(shapeFile, shape);
  const file = path.join(source, 'Interface/Interface_StaticStandards.cxx');
  const original = await readFile(file, 'utf8');
  const patched = replaceOnce(original,
    /  \/\/ load messages if needed[\s\S]*?\n}\s*$/g,
    '  // Native diagnostic text is not exposed by the preview adapter.\n}\n');
  await writeFile(file, patched);
}

// Native console/file diagnostics are not an API of the browser preview. Avoid
// formatting discarded messages in the first place, rather than installing a
// printer and discarding its output. Argument expressions are still evaluated;
// parser checks, exceptions and transfer/healing status are unaffected.
export async function prunePreviewIO(source) {
  const messengerFile = path.join(source, 'Message/Message_Messenger.cxx');
  let messenger = await readFile(messengerFile, 'utf8');
  messenger = replaceOnce(messenger, /  AddPrinter \( new Message_PrinterOStream \);/g,
    '  // The preview has no native diagnostic printer.');
  messenger = replaceBody(messenger, 'Message_Messenger::Send',
    '// Diagnostic output is not exposed by the preview API.', 5);
  await writeFile(messengerFile, messenger);

  const headerFile = path.join(source, 'Message/Message_Messenger.hxx');
  const header = replaceOnce(await readFile(headerFile, 'utf8'),
    /  class StreamBuffer\n  \{[\s\S]*?\n  \};/g, `  class StreamBuffer
  {
  public:
    ~StreamBuffer() { delete myStream; }
    void Flush(Standard_Boolean = Standard_False) {}
    StreamBuffer(const StreamBuffer& theOther)
      : myMessenger(theOther.myMessenger), myStream(NULL) {}
    template <typename T>
    StreamBuffer& operator << (const T&) { return *this; }
    StreamBuffer& operator << (std::ostream& (*)(std::ostream&)) { return *this; }
    // Rare native dump APIs accept an ostream reference. Keep that interface
    // usable, but allocate its buffer only if a caller actually requests it.
    Standard_SStream& Stream()
    {
      if (!myStream) myStream = new Standard_SStream;
      return *myStream;
    }
    operator Standard_OStream& () { return Stream(); }
    Message_Messenger* Messenger() { return myMessenger; }
  private:
    friend class Message_Messenger;
    StreamBuffer(Message_Messenger* theMessenger, Message_Gravity)
      : myMessenger(theMessenger), myStream(NULL) {}
    Message_Messenger* myMessenger;
    Standard_SStream* myStream;
  };`);
  await writeFile(headerFile, header);

  const libraryFile = path.join(source, 'StepSelect/StepSelect_WorkLibrary.cxx');
  const library = replaceBody(await readFile(libraryFile, 'utf8'),
    'StepSelect_WorkLibrary::ReadFile', 'return 1; // Only ReadStream is exposed.');
  await writeFile(libraryFile, library);
  const readerFile = path.join(source, 'StepFile/StepFile_Read.cxx');
  const reader = replaceOnce(await readFile(readerFile, 'utf8'),
    /  \/\/ if stream is not provided, open file stream here[\s\S]*?\n  if \(aStreamPtr->fail\(\)\)/g,
    '  // The adapter provides an in-memory stream; native paths are not exposed.\n'
    + '  std::istream* aStreamPtr = theIStream;\n'
    + '  if (!aStreamPtr || aStreamPtr->fail())');
  await writeFile(readerFile, reader);

  // The browser ships no OCCT resource files or filesystem. Keep the resource
  // maps and programmatic settings used by STEP/shape healing, but do not probe
  // host environment directories or retain the native file/path parser.
  const resourceFile = path.join(source, 'Resource/Resource_Manager.cxx');
  let resource = await readFile(resourceFile, 'utf8');
  resource = replaceBody(resource, 'Resource_Manager::Resource_Manager',
    '// STEP and healing install their built-in defaults programmatically.', 2);
  resource = replaceBody(resource, 'Resource_Manager::Load',
    '// No external resource files are distributed with the preview.');
  await writeFile(resourceFile, resource);
}

function pruneCases(source, excluded) {
  const masked = maskSource(source);
  const ranges = [];
  for (const match of masked.matchAll(/\bswitch\s*\(\s*CN\s*\)\s*\{/g)) {
    const start = match.index + match[0].length;
    const tokens = /[{}]|\bcase\s+(\d+)\s*:|\bdefault\s*:/g;
    tokens.lastIndex = start;
    let depth = 1;
    const labels = [];
    let end;
    for (let token; (token = tokens.exec(masked));) {
      if (token[0] === '{') depth++;
      else if (token[0] === '}') depth--;
      else if (depth === 1) labels.push({ start: token.index, end: tokens.lastIndex, id: token[1] === undefined ? null : Number(token[1]) });
      if (!depth) { end = token.index; break; }
    }
    if (end === undefined) throw new Error('Unbalanced STEP dispatch switch');
    // Consecutive labels can share a body. Drop that body only if every label
    // is excluded; otherwise remove just the excluded labels.
    for (let i = 0; i < labels.length;) {
      let j = i + 1;
      while (j < labels.length && !masked.slice(labels[j - 1].end, labels[j].start).trim()) j++;
      const group = labels.slice(i, j);
      if (group.every(label => excluded.has(label.id))) ranges.push([group[0].start, labels[j]?.start ?? end]);
      else for (const label of group) if (excluded.has(label.id)) ranges.push([label.start, label.end]);
      i = j;
    }
  }
  for (const [start, end] of ranges.sort((a, b) => b[0] - a[0])) source = source.slice(0, start) + source.slice(end);
  return source;
}

function replaceOnce(source, pattern, replacement) {
  if ([...source.matchAll(pattern)].length !== 1) throw new Error(`Unexpected OCCT source: ${pattern}`);
  return source.replace(pattern, replacement);
}

function replaceBody(source, name, body, expected = 1) {
  const masked = maskSource(source);
  const pattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
  const matches = [...masked.matchAll(pattern)];
  if (matches.length !== expected) throw new Error(`Expected ${expected} OCCT methods named ${name}`);
  for (const match of matches.reverse()) {
    const start = masked.indexOf('{', match.index);
    let end = start + 1;
    let depth = 1;
    while (depth && end < masked.length) {
      if (masked[end] === '{') depth++;
      else if (masked[end] === '}') depth--;
      end++;
    }
    if (start < 0 || depth) throw new Error(`Missing OCCT method body: ${name}`);
    source = `${source.slice(0, start + 1)}\n  // Filens read-only build.\n  ${body}\n${source.slice(end - 1)}`;
  }
  return source;
}

function maskSource(source) {
  return source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, match => match.replace(/[^\n]/g, ' '));
}
