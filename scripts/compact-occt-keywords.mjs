import assert from 'node:assert/strict';
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = path.dirname(fileURLToPath(import.meta.url));

// Replace startup-built string maps with immutable sorted tables. Keep both
// full names and short aliases, including the map's last-binding-wins rule.
export async function compactOcctKeywords(source, work) {
  const directory = path.join(source, 'RWStepAP214');
  const file = path.join(directory, 'RWStepAP214_ReadWriteModule.cxx');
  const original = await readFile(file, 'utf8');
  const declarations = [...original.matchAll(/^static TCollection_AsciiString\s+(PasReco|Reco_\w+)\s*\(\s*("[^"\n]+")\s*\);/gm)];
  assert.equal(declarations.length, 684, 'Pinned keyword declarations');
  const strings = new Map(declarations.map(match => [match[1], JSON.parse(match[2])]));
  const constructor = method(original, 'RWStepAP214_ReadWriteModule::RWStepAP214_ReadWriteModule');
  const bindings = { typenums: [], typeshor: [] };
  const masked = maskSource(constructor.body);
  for (const match of constructor.body.matchAll(/\b(typenums|typeshor)\.Bind\s*\(\s*(Reco_\w+|"[^"\n]+")\s*,\s*(\d+)\s*\);/g)) {
    if (!masked.slice(match.index, match.index + 8).trim()) continue;
    const name = match[2].startsWith('"') ? JSON.parse(match[2]) : strings.get(match[2]);
    assert(name && /^[A-Z0-9_]+$/.test(name));
    bindings[match[1]].push([name, Number(match[3])]);
  }
  const tables = Object.fromEntries(Object.entries(bindings).map(([name, rows]) =>
    [name, [...new Map(rows)].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)]));
  assert.equal(bindings.typenums.length, 320, 'Pinned full-name bindings');
  assert.equal(bindings.typeshor.length, 274, 'Pinned short-name bindings');

  const stepType = method(original, 'RWStepAP214_ReadWriteModule::StepType');
  const typeCases = [...maskSource(stepType.body).matchAll(/\bcase\s+(\d+)\s*:\s*return\s+(Reco_\w+)\s*;/g)]
    .map(match => [Number(match[1]), match[2]]);
  assert(typeCases.length > 300 && /default\s*:\s*return PasReco\s*;/.test(stepType.body));
  const names = ['PasReco', ...new Set(typeCases.map(([, name]) => name))];
  const ordinals = new Map(names.map((name, index) => [name, index]));
  const indices = Array(Math.max(...typeCases.map(([id]) => id)) + 1).fill(0);
  for (const [id, name] of typeCases) indices[id] = ordinals.get(name);
  assert.equal(typeCases.length, 320, 'Pinned type-name cases');
  const typeName = id => strings.get(names[indices[id] || 0]);
  for (const [, id] of tables.typeshor) assert(!new Map(tables.typeshor).has(typeName(id)), 'Alias expansion must terminate');
  const complex = method(original, 'RWStepAP214_ReadWriteModule::CaseStep', 'TColStd_SequenceOfAsciiString');
  const reverseComplex = method(original, 'RWStepAP214_ReadWriteModule::ComplexType');
  const rulesBegin = complex.body.indexOf('    if (NbComp == 8)');
  const rulesEnd = /\n    return 0;\s*\n  }\s*\n  return 0;\s*$/.exec(complex.body);
  assert(rulesBegin >= 0 && rulesEnd, 'Pinned complex recognizer structure');
  let rules = complex.body.slice(rulesBegin, rulesEnd.index);
  const comparisons = /types\s*\(\s*(\d+)\s*\)\.IsEqual\(StepType\(\s*(\d+)\s*\)\)/g;
  const checks = [...maskSource(rules).matchAll(comparisons)];
  assert.equal(checks.length, 347, 'Pinned complex comparison count');
  assert(checks.every(match => Number(match[1]) >= 1 && Number(match[1]) <= 8));
  const complexNames = [...new Set(checks.map(match => typeName(Number(match[2]))))].sort();
  assert.equal(complexNames.length, 62, 'Pinned complex spellings');
  const ranks = new Map(complexNames.map((name, index) => [name, index + 1]));
  rules = rules.replace(comparisons, (_all, position, id) => `codes[${Number(position) - 1}] == ${ranks.get(typeName(Number(id)))}`);
  assert(!/\b(?:types|StepType)\s*\(/.test(maskSource(rules)), 'Every comparison must use the equivalent spelling rank');
  const recipes = complexRecipes(rules);
  assert.equal(recipes.length, 145, 'Pinned expanded complex clauses');
  // Every clause specifies the whole tuple. Preserve the first match for
  // duplicate tuples, including explicit rejections, before dropping zeros.
  const firstRecipes = new Map();
  for (const recipe of recipes) {
    const key = recipe.codes.join(',');
    if (!firstRecipes.has(key)) firstRecipes.set(key, recipe);
  }
  const acceptedRecipes = [...firstRecipes.values()].filter(recipe => recipe.type);
  assert.equal(acceptedRecipes.length, 45, 'Pinned nonzero complex rules');
  const data = `${original.slice(0, original.indexOf('#include'))}// Generated from the pinned, pruned protocol; see compact-occt-keywords.mjs.\n`
    + '#include "filens-step-lookup.hpp"\n'
    + Object.entries(tables).map(([name, rows]) => `static const FilensStepKeyword FilensStep_${name}[] = {\n`
      + rows.map(([key, id]) => `{${JSON.stringify(key)}, ${id}}`).join(',\n') + '\n};\n').join('')
    + `static const char* const FilensStepTypeNames[] = {\n${names.map(name => JSON.stringify(strings.get(name))).join(',\n')}\n};\n`
    + `static const unsigned short FilensStepTypeIndices[] = {\n${indices.join(',')}\n};\n`
    + `static const FilensStepKeyword FilensStep_ComplexNames[] = {\n${complexNames.map((name, index) => `{${JSON.stringify(name)}, ${index + 1}}`).join(',\n')}\n};\n`
    + `static const struct FilensStepComplexRule {
  unsigned short type;
  unsigned char count, codes[8];
} FilensStepComplexRules[] = {\n${acceptedRecipes.map(recipe => `{${recipe.type}, ${recipe.codes.length}, {${recipe.codes.join(',')}}}`).join(',\n')}\n};
inline int FilensStepComplexMatch(const int* codes, int count) {
  for (const auto& rule : FilensStepComplexRules) {
    if (rule.count != count) continue;
    int i = 0;
    for (; i < count && rule.codes[i] == codes[i]; ++i) {}
    if (i == count) return rule.type;
  }
  return 0;
}\n`
    + `template <class Sequence>\nint FilensStepRecognizeComplex(const Sequence& theTypes) {
  const int count = theTypes.Length();
  // The original recognizer has rules only for 3..8 components.
  if (count < 3 || count > 8) return 0;
  int codes[8];
  for (int i = 0; i < count; ++i) {
    const auto& key = theTypes(i + 1);
    const int alias = FilensStepLookup(FilensStep_typeshor, ${tables.typeshor.length}, key.ToCString(), key.Length());
    const char* name = alias ? FilensStepTypeNames[alias < ${indices.length} ? FilensStepTypeIndices[alias] : 0] : key.ToCString();
    const int length = alias ? int(std::strlen(name)) : key.Length();
    const int code = FilensStepLookup(FilensStep_ComplexNames, ${complexNames.length}, name, length);
    // Every successful original rule specifies every component. An unknown
    // name cannot match one; rejecting it also avoids sorting it incorrectly.
    if (!code) return 0;
    int j = i;
    for (; j > 0 && codes[j - 1] > code; --j) codes[j] = codes[j - 1];
    codes[j] = code;
  }
  return FilensStepComplexMatch(codes, count);
}\n`;
  await writeFile(path.join(directory, 'filens-step-keywords.pxx'), data);
  await cp(path.join(scripts, 'occt-step-lookup.hpp'), path.join(directory, 'filens-step-lookup.hpp'));

  const wrapper = `#include "filens-step-keywords.pxx"
namespace {
struct FilensStepKeywordMap
{
  const FilensStepKeyword* entries;
  int count;
  bool Find(const TCollection_AsciiString& key, Standard_Integer& type) const
  {
    const int found = FilensStepLookup(entries, count, key.ToCString(), key.Length());
    if (!found) return false;
    type = found;
    return true;
  }
  bool IsBound(const TCollection_AsciiString& key) const
  {
    return FilensStepLookup(entries, count, key.ToCString(), key.Length()) != 0;
  }
};
static const FilensStepKeywordMap typenums = { FilensStep_typenums, ${tables.typenums.length} };
static const FilensStepKeywordMap typeshor = { FilensStep_typeshor, ${tables.typeshor.length} };
}
`;
  let patched = original.slice(0, constructor.start) + '\n  // Filens: immutable keyword tables require no startup registration.\n' + original.slice(constructor.end);
  const currentComplex = method(patched, 'RWStepAP214_ReadWriteModule::CaseStep', 'TColStd_SequenceOfAsciiString');
  patched = patched.slice(0, currentComplex.start) + '\n  return FilensStepRecognizeComplex(theTypes);\n' + patched.slice(currentComplex.end);
  const currentStepType = method(patched, 'RWStepAP214_ReadWriteModule::StepType');
  patched = patched.slice(0, currentStepType.start) + `
  // Preserve reference lifetime and shared names, but allocate spelling only
  // when a complex entity or diagnostic actually asks for its STEP type name.
  static TCollection_AsciiString names[${names.length}];
  const int index = CN >= 0 && CN < ${indices.length} ? FilensStepTypeIndices[CN] : 0;
  TCollection_AsciiString& value = names[index];
  if (value.IsEmpty()) value = FilensStepTypeNames[index];
  return value;
` + patched.slice(currentStepType.end);
  patched = patched.replace('key.IsEqual(Reco_CartesianPoint)', 'key.IsEqual("CARTESIAN_POINT")');
  for (const match of declarations) patched = patched.replace(match[0], '');
  const mapDeclarations = /static NCollection_DataMap<TCollection_AsciiString, Standard_Integer> (?:typenums|typeshor);/g;
  assert.equal([...patched.matchAll(mapDeclarations)].length, 2);
  patched = patched.replace(mapDeclarations, '').replace('// -- General Declarations (Recognize, StepType) ---', wrapper);
  assert(!/\b(?:Reco_\w+|PasReco)\b/.test(maskSource(patched)), 'All former global strings must be removed');
  await writeFile(file, patched);
  const reference = { bindings, typeCases: typeCases.map(([id, name]) => [id, strings.get(name)]), unknownType: strings.get('PasReco'), complexNames,
    complexRecipes: recipes.map(recipe => recipe.codes.map(code => complexNames[code - 1])) };
  await writeFile(path.join(work, 'keyword-reference.json'), `${JSON.stringify(reference, null, 2)}\n`);
  // Compile the original registration and type-name switch as reference code,
  // rather than testing the generated tables only against our own extraction.
  await writeFile(path.join(work, 'keyword-reference.hpp'), `#include <map>
#include <string>
#include <vector>
namespace FilensReference {
typedef int Standard_Integer;
typedef bool Standard_Boolean;
static const bool Standard_False = false, Standard_True = true;
struct String : std::string {
  using std::string::string;
  String(const std::string& value) : std::string(value) {}
  bool IsEqual(const char* value) const { return compare(value) == 0; }
  bool operator > (const String& other) const { return compare(other) > 0; }
  const char* ToCString() const { return c_str(); }
  int Length() const { return int(size()); }
};
typedef String TCollection_AsciiString;
struct Sequence {
  std::vector<String> values;
  int Length() const { return int(values.size()); }
  void Append(const String& value) { values.push_back(value); }
  String& operator () (int index) { return values.at(index - 1); }
  const String& operator () (int index) const { return values.at(index - 1); }
};
typedef Sequence TColStd_SequenceOfAsciiString;
${declarations.map(match => match[0].replace('static TCollection_AsciiString', 'static const char*')).join('\n')}
struct Map {
  std::map<std::string, int> values;
  bool IsEmpty() const { return values.empty(); }
  void Bind(const char* key, int value) { values[key] = value; }
  bool IsBound(const String& key) const { return values.find(key) != values.end(); }
  bool Find(const String& key, int& value) const {
    const auto found = values.find(key);
    if (found == values.end()) return false;
    value = found->second;
    return true;
  }
};
static Map typenums, typeshor;
inline void Initialize() { ${constructor.body} }
inline int Find(int which, const char* key, int length) {
  const auto& values = which ? typeshor.values : typenums.values;
  const auto found = values.find(std::string(key, length));
  return found == values.end() ? 0 : found->second;
}
inline const char* TypeName(int CN) { ${stepType.body} }
struct Reader {
  const char* StepType(int CN) const { return TypeName(CN); }
  int CaseStep(const Sequence& theTypes) const { ${complex.body} }
  bool ComplexType(int CN, Sequence& types) const { ${reverseComplex.body} }
};
}
`);
  const layout = { globalStringObjects: declarations.length, cachedTypeNames: names.length, fullNameBindings: bindings.typenums.length,
    shortNameBindings: bindings.typeshor.length, fullNameEntries: tables.typenums.length, shortNameEntries: tables.typeshor.length,
    typeCases: typeCases.length, typeIndexEntries: indices.length, complexNames: complexNames.length, complexComparisons: checks.length,
    complexAlternatives: recipes.length, complexRules: acceptedRecipes.length };
  await writeFile(path.join(work, 'keyword-layout.json'), `${JSON.stringify(layout, null, 2)}\n`);
  console.log(`Compacted STEP keyword tables: ${JSON.stringify(layout)}`);
}

// Parse the pinned recognizer's simple Boolean clauses into complete tuples.
// Reject any unexpected syntax or partially specified tuple instead of
// silently changing a rule when the upstream source is updated.
function complexRecipes(source) {
  const masked = maskSource(source), recipes = [];
  let count;
  for (const match of masked.matchAll(/\bif\s*\(/g)) {
    const start = masked.indexOf('(', match.index) + 1;
    let end = start, depth = 1;
    while (depth && end < masked.length) {
      if (masked[end] === '(') depth++;
      else if (masked[end] === ')') depth--;
      end++;
    }
    assert.equal(depth, 0);
    const condition = masked.slice(start, end - 1).trim();
    const components = /^NbComp\s*==\s*(\d+)$/.exec(condition);
    if (components) { count = Number(components[1]); continue; }
    const result = /^\s*\{\s*return\s+(\d+)\s*;\s*\}/.exec(masked.slice(end));
    assert(result && count >= 3 && count <= 8, 'Pinned complete complex clause');
    const atoms = condition.replace(/codes\[(\d+)\]\s*==\s*(\d+)/g, 'p$1c$2').replace(/\s/g, '');
    const tokens = atoms.match(/p\d+c\d+|&&|\|\||[()]/g) || [];
    assert.equal(tokens.join(''), atoms, 'Only tuple comparisons and Boolean connectives');
    let cursor = 0;
    const primary = () => {
      const token = tokens[cursor++];
      if (token === '(') { const value = or(); assert.equal(tokens[cursor++], ')'); return value; }
      const atom = /^p(\d+)c(\d+)$/.exec(token);
      assert(atom, `Complex comparison ${token}`);
      return [[[Number(atom[1]), Number(atom[2])]]];
    };
    const and = () => {
      let value = primary();
      while (tokens[cursor] === '&&') { cursor++; const next = primary(); value = value.flatMap(a => next.map(b => [...a, ...b])); }
      return value;
    };
    const or = () => {
      let value = and();
      while (tokens[cursor] === '||') { cursor++; value = [...value, ...and()]; }
      return value;
    };
    for (const alternative of or()) {
      const codes = Array(count).fill(0);
      for (const [position, code] of alternative) {
        assert(position < count && (!codes[position] || codes[position] === code), 'Consistent component position');
        codes[position] = code;
      }
      assert(codes.every(Boolean), 'Every successful or rejecting rule specifies every component');
      recipes.push({ codes, type: Number(result[1]) });
    }
    assert.equal(cursor, tokens.length);
  }
  assert(recipes.length > 50);
  return recipes;
}

function method(source, name, signature = '') {
  const masked = maskSource(source);
  const matches = [...masked.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))]
    .filter(match => masked.slice(match.index, masked.indexOf('{', match.index)).includes(signature));
  assert.equal(matches.length, 1, `Pinned method ${name}`);
  const start = masked.indexOf('{', matches[0].index) + 1;
  let depth = 1, end = start;
  while (depth && end < masked.length) {
    if (masked[end] === '{') depth++;
    else if (masked[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0);
  return { start, end: end - 1, body: source.slice(start, end - 1) };
}

function maskSource(source) {
  return source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, match => match.replace(/[^\n]/g, ' '));
}
