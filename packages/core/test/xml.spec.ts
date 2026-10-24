import { describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { loadPptxArchive } from '../src/parser/archive';
import { parseXmlFile, parseXmlFileOrdered } from '../src/parser/xml';
import { parseOpenXml } from '../src/parser/ordered-xml';
import { readFixture } from './helpers';

const options = { ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false, trimValues: false, parseAttributeValue: false };
const reference = new XMLParser(options);
const orderedReference = new XMLParser({ ...options, preserveOrder: true });

describe('shared ordered and lookup XML views', () => {
  it.each([
    '<a x="one\r\ntwo\tthree">left<!-- comment -->right <![CDATA[raw &amp;]]> tail </a>',
    '<a x="&quot;&apos;&amp;&lt;&gt;">&#38; &#x26; &#60; &#x3C; &#62; &#x3E; &#34; &#x22; &#39; &#x27; &#8226; &amp;lt; &unknown;</a>',
    '<?xml version="1.0" encoding="UTF-8"?><a x="a > b" y=\'a < b\'><b/><b id=""/></a>\n',
    '<a> before <b> middle </b> after <![CDATA[]]></a>'
  ])('preserves ordered text, whitespace and entity semantics: %s', source => {
    expect(parseOpenXml(source)).toEqual(orderedReference.parse(source));
  });

  it.each([
    '<!DOCTYPE a [<!ENTITY custom "expanded">]><a>&custom;</a>',
    '<?custom instruction?><a/>',
    '<a constructor="reserved"/>',
    '<__proto__/>',
    '<a><b></a>',
    '<a>'.repeat(103) + '</a>'.repeat(103)
  ])('defers unsupported syntax and excessive nesting: %s', source => {
    expect(parseOpenXml(source)).toBeNull();
  });

  it('retains the full parser for custom entities and processing instructions', async () => {
    for (const source of [
      '<!DOCTYPE a [<!ENTITY custom "expanded">]><a>&custom;</a>',
      '<?custom instruction?><a/>'
    ]) {
      const zip = new JSZip().file('fallback.xml', source);
      const archive = await loadPptxArchive(await zip.generateAsync({ type: 'uint8array' }));
      expect(await parseXmlFileOrdered(archive, 'fallback.xml')).toEqual(orderedReference.parse(source));
      expect(await parseXmlFile(archive, 'fallback.xml')).toEqual(reference.parse(source));
    }
  });

  it('retains attributes, mixed text order, repeated and empty tags', async () => {
    const source = '<?xml version="1.0"?><p:sld xmlns:p="p"><p:p id="0"><p:r>A &amp; B</p:r><p:br/><p:r><![CDATA[C < D]]></p:r><p:fld type="date">2026</p:fld> tail </p:p><p:p/><p:p flag=""/><p:group><p:child/><p:child a="x"/></p:group></p:sld>';
    const zip = new JSZip().file('slide.xml', source);
    const archive = await loadPptxArchive(await zip.generateAsync({ type: 'uint8array' }));
    expect(await parseXmlFile(archive, 'slide.xml')).toEqual(reference.parse(source));
    expect(await parseXmlFileOrdered(archive, 'slide.xml')).toEqual(new XMLParser({ ...options, preserveOrder: true }).parse(source));
    expect(await parseXmlFile(archive, 'missing.xml')).toBeNull();
  });

  it('matches the previous lookup parser for every XML part in representative presentations', async () => {
    for (const fixture of [
      'fixtures-text-theme.pptx', 'fixtures-grouped-media.pptx', 'fixtures-table-style-text.pptx',
      '../../apps/demo/public/samples/vue-office-test.pptx',
      '../../apps/demo/public/samples/filens-field-notes.pptx',
      '../../apps/demo/public/samples/rich-pptx-shapes.pptx',
      '../../apps/demo/public/samples/rich-pptx-pictures.pptx',
      '../../apps/demo/public/samples/sample-deck.pptx'
    ]) {
      const bytes = await readFixture(fixture);
      const zip = await JSZip.loadAsync(bytes);
      const archive = await loadPptxArchive(bytes);
      for (const entry of Object.values(zip.files)) {
        if (!entry.name.endsWith('.xml') && !entry.name.endsWith('.rels')) continue;
        const source = await entry.async('text');
        expect(parseOpenXml(source), `${fixture}: ${entry.name}`).toEqual(orderedReference.parse(source));
        expect(await parseXmlFile(archive, entry.name), `${fixture}: ${entry.name}`).toEqual(reference.parse(source));
      }
    }
  });
});
