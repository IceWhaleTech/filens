import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import JSZip from 'jszip';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUTPUTS = {
  sampleDeck: path.resolve(ROOT, 'apps/demo/public/samples/sample-deck.pptx'),
  textTheme: path.resolve(ROOT, 'packages/core/fixtures-text-theme.pptx'),
  groupedMedia: path.resolve(ROOT, 'packages/core/fixtures-grouped-media.pptx'),
  tableFixture: path.resolve(ROOT, 'packages/core/fixtures-table-placeholder.pptx'),
  unsupportedShape: path.resolve(ROOT, 'packages/core/fixtures-unsupported-shape.pptx'),
  shapeTextBounds: path.resolve(ROOT, 'packages/core/fixtures-shape-text-bounds.pptx'),
  tableStyleText: path.resolve(ROOT, 'packages/core/fixtures-table-style-text.pptx'),
  bodyPrWrapAnchor: path.resolve(ROOT, 'packages/core/fixtures-bodypr-wrap-anchor.pptx')
};
const GROUPED_MEDIA_EXTERNAL_URL = 'https://example.com/pptx-previewer/grouped-media';

const IMAGE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAOEAAABkCAYAAADf9N2kAAAACXBIWXMAAAsSAAALEgHS3X78AAABl0lEQVR4nO3XQQ3CMBQFQbD//8o4M2MvmP0xSg6u40qCMgfHdCqkfNNpJBIAAAAAAAAAAAAAAAC4F86Xxv9P+V7xv0v+1n7wC0sL7j8r5x5wq0vI8r9y95sK+uZq8n9sHfD8W0zZ9sQ3mW+7QqQ4YwWmA8XzrqK1tLzvB7yQ2o3W7Jm4cB8zvfe3aX0bQnH8xW7ZfR+8Jm6nG3t6s8iQ0k0x5z6L1f2ZQ1n2iD5x1r4C8Yz4A2YIh4hYq0e6kJf6f0w2m1YVh7b3jYzM8L7lQ8Q8H0dY0Jr7+S5lbp0oB4YQ1mY6s4q3Q+0v2d3gF8l3Q3mW7vUFXb+2r7fDkJQ4o4Y0WmE8XzprK1tJzvB7yQ2o3W7Jm4cB8zvfe3aX0bQnH8xW7ZfR+8Jm6nG3t6s8iQ0k0x5z6L1f2ZQ1n2iD5x1r4C8Yz4A2YIh4hYq0e6kJf6f0w2m1YVh7b3jYzM8L7lQ8Q8H0dY0Jr7+S5lbp0oB4YQ1mY6s4q3Q+0v2d3gEAAAAAAAAAAAAAAAD4L3wAW3QxY7m5vVQAAAAASUVORK5CYII=';

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const coreProps = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>PPTX Previewer Fixture</dc:title>
  <dc:creator>OpenAI Codex</dc:creator>
</cp:coreProperties>`;

const appProps = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>OpenAI Codex</Application>
</Properties>`;

const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/>
    <p:sldId id="257" r:id="rId3"/>
    <p:sldId id="258" r:id="rId4"/>
  </p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;

const presentationRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>
</Relationships>`;

const slideMaster = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="Master">
    <p:bg>
      <p:bgPr>
        <a:solidFill><a:schemeClr val="bg1"/></a:solidFill>
      </p:bgPr>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Master Accent"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="457200" y="300000"/><a:ext cx="8230000" cy="120000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:schemeClr val="accent1"/></a:solidFill>
          <a:ln w="0"><a:noFill/></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Master Title"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="title"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="685800" y="457200"/><a:ext cx="7772400" cy="762000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr anchor="ctr"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="l"/>
            <a:r>
              <a:rPr sz="2800" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>
              <a:t>Master Title</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="4" name="Master Body"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="685800" y="1371600"/><a:ext cx="7772400" cy="2743200"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr anchor="ctr" lIns="182880" rIns="137160" tIns="91440" bIns="68580"/>
          <a:lstStyle/>
          <a:p>
            <a:r><a:rPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>Master body</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="5" name="Master Bullet Body"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="body" idx="2"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="5943600" y="3952240"/><a:ext cx="2514600" cy="914400"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr anchor="b" lIns="137160" rIns="91440" tIns="68580" bIns="91440"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr lvl="0" marL="342900" indent="-171450">
              <a:buChar char="&#8226;"/>
            </a:pPr>
            <a:r>
              <a:rPr sz="1600" i="1"><a:solidFill><a:schemeClr val="accent6"/></a:solidFill></a:rPr>
              <a:t>Master bullet body</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
</p:sldMaster>`;

const slideMasterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

const slideLayout = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="titleAndContent" preserve="1">
  <p:cSld name="Layout">
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Layout Title"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="title"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="685800" y="457200"/><a:ext cx="7772400" cy="762000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Layout Body"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="685800" y="1371600"/><a:ext cx="7772400" cy="2743200"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="4" name="Layout Bullet Body"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="body" idx="2"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="5943600" y="3952240"/><a:ext cx="2514600" cy="914400"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sldLayout>`;

const slideLayoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

const theme = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Preview Theme">
  <a:themeElements>
    <a:clrScheme name="Preview Scheme">
      <a:dk1><a:srgbClr val="122033"/></a:dk1>
      <a:lt1><a:srgbClr val="F6F8FB"/></a:lt1>
      <a:dk2><a:srgbClr val="20324A"/></a:dk2>
      <a:lt2><a:srgbClr val="FFFFFF"/></a:lt2>
      <a:accent1><a:srgbClr val="2F6BFF"/></a:accent1>
      <a:accent2><a:srgbClr val="FF7A59"/></a:accent2>
      <a:accent3><a:srgbClr val="2ABF88"/></a:accent3>
      <a:accent4><a:srgbClr val="FFB020"/></a:accent4>
      <a:accent5><a:srgbClr val="8A63D2"/></a:accent5>
      <a:accent6><a:srgbClr val="25A7C5"/></a:accent6>
      <a:hlink><a:srgbClr val="2F6BFF"/></a:hlink>
      <a:folHlink><a:srgbClr val="8A63D2"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Preview Fonts">
      <a:majorFont>
        <a:latin typeface="Aptos"/>
        <a:font script="Hans" typeface="等线 Light"/>
        <a:font script="Jpan" typeface="Yu Gothic"/>
        <a:font script="Hang" typeface="Malgun Gothic"/>
      </a:majorFont>
      <a:minorFont>
        <a:latin typeface="Calibri"/>
        <a:font script="Hans" typeface="等线"/>
        <a:font script="Jpan" typeface="Yu Gothic"/>
        <a:font script="Hang" typeface="Malgun Gothic"/>
      </a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Preview Format">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:gradFill rotWithShape="1">
          <a:gsLst>
            <a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="65000"/></a:schemeClr></a:gs>
            <a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs>
          </a:gsLst>
          <a:lin ang="0" scaled="1"/>
        </a:gradFill>
        <a:pattFill prst="diagCross">
          <a:fgClr><a:schemeClr val="phClr"/></a:fgClr>
          <a:bgClr><a:schemeClr val="lt1"><a:alpha val="82000"/></a:schemeClr></a:bgClr>
        </a:pattFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="12700" cap="rnd">
          <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
          <a:round/>
        </a:ln>
        <a:ln w="19050" cap="sq">
          <a:solidFill><a:schemeClr val="phClr"><a:shade val="75000"/></a:schemeClr></a:solidFill>
          <a:bevel/>
        </a:ln>
        <a:ln w="28575">
          <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        </a:ln>
      </a:lnStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"><a:shade val="90000"/></a:schemeClr></a:solidFill>
        <a:gradFill rotWithShape="1">
          <a:gsLst>
            <a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="60000"/></a:schemeClr></a:gs>
            <a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs>
          </a:gsLst>
          <a:lin ang="5400000" scaled="1"/>
        </a:gradFill>
      </a:bgFillStyleLst>
      <a:effectStyleLst>
        <a:effectStyle>
          <a:effectLst>
            <a:outerShdw blurRad="76200" dist="50800" dir="2700000" rotWithShape="0">
              <a:schemeClr val="phClr"><a:alpha val="36000"/></a:schemeClr>
            </a:outerShdw>
          </a:effectLst>
        </a:effectStyle>
        <a:effectStyle>
          <a:effectLst>
            <a:outerShdw blurRad="63500" dist="38100" dir="5400000" rotWithShape="0">
              <a:schemeClr val="phClr"><a:alpha val="24000"/></a:schemeClr>
            </a:outerShdw>
          </a:effectLst>
        </a:effectStyle>
        <a:effectStyle>
          <a:effectLst>
            <a:outerShdw blurRad="50800" dist="25400" dir="0" rotWithShape="0">
              <a:schemeClr val="phClr"><a:alpha val="18000"/></a:schemeClr>
            </a:outerShdw>
          </a:effectLst>
        </a:effectStyle>
      </a:effectStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;

const slide1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="Text Theme">
    <p:bg>
      <p:bgPr>
        <a:solidFill><a:schemeClr val="lt1"/></a:solidFill>
      </p:bgPr>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Title 1"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="title"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="685800" y="457200"/><a:ext cx="7772400" cy="762000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr anchor="ctr"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"/>
            <a:r>
              <a:rPr sz="3000" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>
              <a:t>PPTX Previewer</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Content Placeholder 2"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="685800" y="1371600"/><a:ext cx="7772400" cy="2743200"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr sz="2000"><a:solidFill><a:schemeClr val="accent1"><a:tint val="25000"/></a:schemeClr></a:solidFill></a:rPr>
              <a:t>Theme colors, placeholder inheritance and text runs.</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:pPr algn="l"/>
            <a:r>
              <a:rPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>
              <a:t>This deck is generated inside the repository.</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:t>Inherited master body style.</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1700" u="sng">
                <a:solidFill><a:schemeClr val="accent1"/></a:solidFill>
                <a:hlinkClick r:id="rId2"/>
              </a:rPr>
              <a:t>Open preview documentation</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1700">
                <a:hlinkClick r:id="rId2"/>
              </a:rPr>
              <a:t>Theme fallback link</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1800" lang="zh-CN">
                <a:solidFill><a:schemeClr val="tx1"/></a:solidFill>
              </a:rPr>
              <a:t>中文主题字体</a:t>
            </a:r>
          </a:p>
          __INTERNAL_LINK_PARAGRAPH__
          <a:p>
            <a:pPr marL="342900" indent="-171450">
              <a:buChar char="&#8226;"/>
              <a:spcBef><a:spcPts val="1200"/></a:spcBef>
              <a:spcAft><a:spcPts val="800"/></a:spcAft>
              <a:lnSpc><a:spcPct val="125000"/></a:lnSpc>
            </a:pPr>
            <a:r>
              <a:rPr sz="1700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>
              <a:t>Bullet paragraphs now keep indentation and spacing.</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:pPr marL="342900" indent="-171450">
              <a:buAutoNum type="arabicPeriod" startAt="3"/>
            </a:pPr>
            <a:r>
              <a:rPr sz="1700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>
              <a:t>Ordered roadmap item one.</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:pPr marL="342900" indent="-171450">
              <a:buAutoNum type="arabicPeriod"/>
            </a:pPr>
            <a:r>
              <a:rPr sz="1700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>
              <a:t>Ordered roadmap item two.</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1700" strike="sngStrike">
                <a:solidFill><a:schemeClr val="tx1"/></a:solidFill>
                <a:highlight><a:srgbClr val="FFF3A3"/></a:highlight>
              </a:rPr>
              <a:t>Deprecated copy</a:t>
            </a:r>
            <a:r>
              <a:rPr sz="1700" b="1"><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></a:rPr>
              <a:t> is now replaced with highlighted runs.</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>
              <a:t>CO</a:t>
            </a:r>
            <a:r>
              <a:rPr sz="1700" baseline="-25000"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:rPr>
              <a:t>2</a:t>
            </a:r>
            <a:r>
              <a:rPr sz="1700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>
              <a:t> baseline and x</a:t>
            </a:r>
            <a:r>
              <a:rPr sz="1700" baseline="30000"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:rPr>
              <a:t>2</a:t>
            </a:r>
            <a:r>
              <a:rPr sz="1700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>
              <a:t> notation.</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>
              <a:t>Line one</a:t>
            </a:r>
            <a:br>
              <a:rPr sz="1500" b="1"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:rPr>
            </a:br>
            <a:r>
              <a:rPr sz="1700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>
              <a:t>Line two</a:t>
            </a:r>
            <a:tab/>
            <a:fld id="{00000000-0000-0000-0000-000000000001}" type="slidenum">
              <a:rPr sz="1700" i="1"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:rPr>
              <a:t>Field tail</a:t>
            </a:fld>
          </a:p>
          <a:p>
            <a:pPr>
              <a:tabLst>
                <a:tab pos="1828800"/>
                <a:tab pos="3200400"/>
              </a:tabLst>
            </a:pPr>
            <a:r>
              <a:rPr sz="1700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>
              <a:t>Milestone</a:t>
            </a:r>
            <a:tab/>
            <a:r>
              <a:rPr sz="1700" b="1"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:rPr>
              <a:t>Owner</a:t>
            </a:r>
            <a:tab/>
            <a:r>
              <a:rPr sz="1700"><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></a:rPr>
              <a:t>Done</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>
              <a:t>co</a:t>
            </a:r>
            <a:softHyphen/>
            <a:r>
              <a:rPr sz="1700"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:rPr>
              <a:t>operate and re</a:t>
            </a:r>
            <a:noBreakHyphen/>
            <a:r>
              <a:rPr sz="1700" b="1"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:rPr>
              <a:t>enter</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1700">
                <a:solidFill><a:schemeClr val="tx1"/></a:solidFill>
                <a:latin typeface="+mj-lt"/>
              </a:rPr>
              <a:t>Theme heading font</a:t>
            </a:r>
            <a:r>
              <a:rPr sz="1700">
                <a:solidFill><a:schemeClr val="accent3"/></a:solidFill>
                <a:latin typeface="+mn-lt"/>
              </a:rPr>
              <a:t> + body font</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1700"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>
              <a:t>Status </a:t>
            </a:r>
            <a:sym font="Segoe UI Symbol" char="&#x2713;"/>
            <a:r>
              <a:rPr sz="1700"><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></a:rPr>
              <a:t> complete</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="4" name="Content Placeholder 3"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="body" idx="2"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="5943600" y="3952240"/><a:ext cx="2514600" cy="914400"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:r>
              <a:t>Inherited bullet placeholder style.</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="5" name="Accent Card"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="685800" y="3810000"/><a:ext cx="2743200" cy="762000"/></a:xfrm>
          <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:schemeClr val="accent2"><a:lumOff val="10000"/></a:schemeClr></a:solidFill>
          <a:ln w="12700"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr anchor="ctr"/>
          <a:lstStyle/>
          <a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1600" b="1"><a:solidFill><a:schemeClr val="lt2"/></a:solidFill></a:rPr><a:t>HTML + SVG</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;

const slide1Rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/pptx-previewer" TargetMode="External"/>
  __INTERNAL_LINK_REL__
</Relationships>`;

const slide2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="Grouped Media">
    <p:bg>
      <p:bgPr>
        <a:gradFill rotWithShape="1">
          <a:gsLst>
            <a:gs pos="0"><a:schemeClr val="lt1"/></a:gs>
            <a:gs pos="65000"><a:schemeClr val="accent6"><a:alpha val="12000"/></a:schemeClr></a:gs>
            <a:gs pos="100000"><a:schemeClr val="accent1"><a:alpha val="16000"/></a:schemeClr></a:gs>
          </a:gsLst>
          <a:lin ang="5400000" scaled="1"/>
        </a:gradFill>
      </p:bgPr>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm>
      </p:grpSpPr>
      <p:pic>
        <p:nvPicPr>
          <p:cNvPr id="2" name="Hero Image">__IMAGE_LINK__</p:cNvPr>
          <p:cNvPicPr/>
          <p:nvPr/>
        </p:nvPicPr>
        <p:blipFill>
          <a:blip r:embed="rId2"><a:alphaModFix amt="68000"/></a:blip>
          <a:srcRect l="8000" r="12000" t="5000" b="15000"/>
          <a:stretch><a:fillRect/></a:stretch>
        </p:blipFill>
        <p:spPr>
          <a:xfrm><a:off x="685800" y="914400"/><a:ext cx="3657600" cy="2057400"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:ln w="19050">
            <a:solidFill><a:schemeClr val="accent2"/></a:solidFill>
            <a:prstDash val="dashDot"/>
          </a:ln>
        </p:spPr>
      </p:pic>
      <p:grpSp>
        <p:nvGrpSpPr>
          <p:cNvPr id="10" name="Grouped Shapes"/>
          <p:cNvGrpSpPr/>
          <p:nvPr/>
        </p:nvGrpSpPr>
        <p:grpSpPr>
          <a:xfrm>
            <a:off x="4800600" y="1143000"/>
            <a:ext cx="2743200" cy="1981200"/>
            <a:chOff x="0" y="0"/>
            <a:chExt cx="2743200" cy="1981200"/>
          </a:xfrm>
        </p:grpSpPr>
        <p:sp>
          <p:nvSpPr><p:cNvPr id="11" name="Group Panel"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="1981200"/></a:xfrm>
            <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
            <a:solidFill><a:schemeClr val="accent3"><a:tint val="65000"/></a:schemeClr></a:solidFill>
            <a:ln w="19050"><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></a:ln>
          </p:spPr>
        </p:sp>
        <p:cxnSp>
          <p:nvCxnSpPr><p:cNvPr id="12" name="Connector"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
          <p:spPr>
            <a:xfrm><a:off x="228600" y="457200"/><a:ext cx="1828800" cy="228600"/></a:xfrm>
            <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
            <a:ln w="28575" cap="rnd">
              <a:solidFill><a:schemeClr val="accent1"><a:alpha val="62000"/></a:schemeClr></a:solidFill>
              <a:round/>
              <a:headEnd type="oval"/>
              <a:tailEnd type="triangle"/>
            </a:ln>
          </p:spPr>
        </p:cxnSp>
        <p:sp>
          <p:nvSpPr><p:cNvPr id="13" name="Callout">__GROUP_SHAPE_LINK__</p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="1143000" y="914400"/><a:ext cx="1143000" cy="685800"/></a:xfrm>
            <a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
            <a:solidFill><a:schemeClr val="accent1"/></a:solidFill>
            <a:ln><a:noFill/></a:ln>
          </p:spPr>
          <p:txBody>
            <a:bodyPr anchor="ctr"/>
            <a:lstStyle/>
            <a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1400" b="1"><a:solidFill><a:schemeClr val="lt2"/></a:solidFill></a:rPr><a:t>Group</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
      </p:grpSp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="30" name="Gradient Note"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="4800600" y="457200"/><a:ext cx="2743200" cy="548640"/></a:xfrm>
          <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
          <a:gradFill rotWithShape="1">
            <a:gsLst>
              <a:gs pos="0"><a:schemeClr val="accent1"/></a:gs>
              <a:gs pos="50000"><a:schemeClr val="accent6"><a:alpha val="78000"/></a:schemeClr></a:gs>
              <a:gs pos="100000"><a:schemeClr val="accent3"/></a:gs>
            </a:gsLst>
            <a:lin ang="0" scaled="1"/>
          </a:gradFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln>
          <a:effectLst>
            <a:outerShdw blurRad="63500" dist="38100" dir="5400000" rotWithShape="0">
              <a:schemeClr val="accent1"><a:alpha val="32000"/></a:schemeClr>
            </a:outerShdw>
          </a:effectLst>
        </p:spPr>
        <p:txBody>
          <a:bodyPr anchor="ctr"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"/>
            <a:r>
              <a:rPr sz="1400" b="1"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:rPr>
              <a:t>Gradient surface support</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="31" name="Theme Style Panel"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="4800600" y="3025140"/><a:ext cx="2514600" cy="548640"/></a:xfrm>
          <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:style>
          <a:lnRef idx="2"><a:schemeClr val="accent4"/></a:lnRef>
          <a:fillRef idx="2"><a:schemeClr val="accent3"/></a:fillRef>
          <a:effectRef idx="0"><a:schemeClr val="accent3"/></a:effectRef>
          <a:fontRef idx="minor"><a:schemeClr val="lt2"/></a:fontRef>
        </p:style>
        <p:txBody>
          <a:bodyPr anchor="ctr"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"/>
            <a:r>
              <a:rPr sz="1400" b="1"/>
              <a:t>Theme style matrix</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="14" name="Status Note"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="685800" y="3314700"/><a:ext cx="3657600" cy="685800"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:schemeClr val="accent2"><a:alpha val="18000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050">
            <a:solidFill><a:schemeClr val="accent2"/></a:solidFill>
            <a:prstDash val="dash"/>
          </a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr sz="1600" b="1"><a:solidFill><a:schemeClr val="accent2"><a:alpha val="54000"/></a:schemeClr></a:solidFill></a:rPr>
              <a:t>Text box styles now keep fill and outline.</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="32" name="Picture Fill Card"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="685800" y="2514600"/><a:ext cx="3657600" cy="594360"/></a:xfrm>
          <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
          <a:blipFill rotWithShape="1">
            <a:blip r:embed="rId2"><a:alphaModFix amt="72000"/></a:blip>
            <a:srcRect l="12000" r="6000" t="10000" b="8000"/>
            <a:stretch><a:fillRect/></a:stretch>
          </a:blipFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent6"/></a:solidFill></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr anchor="ctr"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"/>
            <a:r>
              <a:rPr sz="1400" b="1"><a:solidFill><a:schemeClr val="lt2"/></a:solidFill></a:rPr>
              <a:t>Picture fill support</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="33" name="Pattern Style Chip"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="4445000" y="2260000"/><a:ext cx="2057400" cy="365760"/></a:xfrm>
          <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
          <a:ln w="12700"><a:solidFill><a:schemeClr val="accent5"/></a:solidFill></a:ln>
        </p:spPr>
        <p:style>
          <a:lnRef idx="1"><a:schemeClr val="accent5"/></a:lnRef>
          <a:fillRef idx="3"><a:schemeClr val="accent5"/></a:fillRef>
          <a:effectRef idx="0"><a:schemeClr val="accent5"/></a:effectRef>
          <a:fontRef idx="minor"><a:schemeClr val="dk1"/></a:fontRef>
        </p:style>
        <p:txBody>
          <a:bodyPr anchor="ctr"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"/>
            <a:r>
              <a:rPr sz="1300" b="1"/>
              <a:t>Theme pattern fill</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="15" name="List Style Note"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="685800" y="4114800"/><a:ext cx="3657600" cy="762000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle>
            <a:lvl1pPr marL="342900" indent="-171450">
              <a:buChar char="&#8226;"/>
              <a:defRPr sz="1800" i="1">
                <a:solidFill><a:schemeClr val="accent3"/></a:solidFill>
              </a:defRPr>
            </a:lvl1pPr>
          </a:lstStyle>
          <a:p>
            <a:pPr lvl="0"/>
            <a:r><a:t>Inherited list style item</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="34" name="Pattern Note"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="685800" y="2057400"/><a:ext cx="3383280" cy="365760"/></a:xfrm>
          <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
          <a:pattFill prst="diagCross">
            <a:fgClr><a:schemeClr val="accent6"/></a:fgClr>
            <a:bgClr><a:schemeClr val="lt1"><a:alpha val="88000"/></a:schemeClr></a:bgClr>
          </a:pattFill>
          <a:ln w="12700"><a:solidFill><a:schemeClr val="accent6"/></a:solidFill></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr anchor="ctr"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"/>
            <a:r>
              <a:rPr sz="1300" b="1"><a:solidFill><a:schemeClr val="dk1"><a:alpha val="76000"/></a:schemeClr></a:solidFill><a:highlight><a:schemeClr val="accent1"><a:alpha val="26000"/></a:schemeClr></a:highlight></a:rPr>
              <a:t>Pattern fill note</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="38" name="Vertical Label"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="4160520" y="1943100"/><a:ext cx="411480" cy="1097280"/></a:xfrm>
          <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:schemeClr val="accent1"><a:alpha val="16000"/></a:schemeClr></a:solidFill>
          <a:ln w="12700"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr anchor="ctr" vert="vert270"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"/>
            <a:r>
              <a:rPr sz="1300" b="1"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:rPr>
              <a:t>Vertical label</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="16" name="Flow Arrow"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="4800600" y="3520440"/><a:ext cx="2514600" cy="548640"/></a:xfrm>
          <a:prstGeom prst="rightArrow">
            <a:avLst>
              <a:gd name="adj1" fmla="val 52000"/>
              <a:gd name="adj2" fmla="val 42000"/>
            </a:avLst>
          </a:prstGeom>
          <a:solidFill><a:schemeClr val="accent1"><a:tint val="40000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050" cap="sq"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:bevel/></a:ln>
        </p:spPr>
      </p:sp>
      __EXTRA_SLIDE2_SHAPES__
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;

const slide2Rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
  __IMAGE_LINK_REL__
  __GROUP_SHAPE_LINK_REL__
</Relationships>`;

const SUPPORTED_SLIDE2_SHAPES = `      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="17" name="Notched Arrow"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="4800600" y="4183380"/><a:ext cx="2057400" cy="457200"/></a:xfrm>
          <a:prstGeom prst="notchedRightArrow">
            <a:avLst>
              <a:gd name="adj1" fmla="pin 20000 48000 60000"/>
              <a:gd name="adj2" fmla="+- adj1 2000 4000"/>
            </a:avLst>
          </a:prstGeom>
          <a:solidFill><a:schemeClr val="accent2"><a:tint val="52000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="18" name="Home Plate"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="6972300" y="3985260"/><a:ext cx="731520" cy="731520"/></a:xfrm>
          <a:prstGeom prst="homePlate">
            <a:avLst><a:gd name="adj" fmla="abs -32000"/></a:avLst>
          </a:prstGeom>
          <a:solidFill><a:schemeClr val="accent4"><a:tint val="30000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent4"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="19" name="Right Triangle"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="7837800" y="3985260"/><a:ext cx="822960" cy="731520"/></a:xfrm>
          <a:prstGeom prst="rtTriangle"><a:avLst/></a:prstGeom>
          <a:solidFill><a:schemeClr val="accent3"><a:tint val="38000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="20" name="Process Cloud"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="4800600" y="4625340"/><a:ext cx="1463040" cy="420624"/></a:xfrm>
          <a:prstGeom prst="cloud"><a:avLst/></a:prstGeom>
          <a:gradFill rotWithShape="1">
            <a:gsLst>
              <a:gs pos="0"><a:schemeClr val="accent5"/></a:gs>
              <a:gs pos="100000"><a:schemeClr val="accent6"/></a:gs>
            </a:gsLst>
            <a:lin ang="2700000" scaled="1"/>
          </a:gradFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent5"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="21" name="Data Cube"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="6469380" y="4511040"/><a:ext cx="960120" cy="548640"/></a:xfrm>
          <a:prstGeom prst="cube"><a:avLst/></a:prstGeom>
          <a:solidFill><a:schemeClr val="accent6"><a:tint val="35000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent6"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="36" name="Star Badge"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="7917180" y="4526280"/><a:ext cx="731520" cy="731520"/></a:xfrm>
          <a:prstGeom prst="star5">
            <a:avLst><a:gd name="adj" fmla="cos 22000 0"/></a:avLst>
          </a:prstGeom>
          <a:solidFill><a:schemeClr val="accent1"><a:tint val="35000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="37" name="Octagon Chip"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="7086600" y="3764280"/><a:ext cx="822960" cy="640080"/></a:xfrm>
          <a:prstGeom prst="octagon">
            <a:avLst><a:gd name="adj" fmla="*/ 13000 4 2"/></a:avLst>
          </a:prstGeom>
          <a:solidFill><a:schemeClr val="accent6"><a:tint val="40000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent6"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="39" name="Plaque Banner"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="5486400" y="5181600"/><a:ext cx="1325880" cy="365760"/></a:xfrm>
          <a:prstGeom prst="plaque"><a:avLst/></a:prstGeom>
          <a:solidFill><a:schemeClr val="accent2"><a:tint val="42000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="40" name="Can Pillar"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="6860520" y="5135880"/><a:ext cx="685800" cy="411480"/></a:xfrm>
          <a:prstGeom prst="can"><a:avLst/></a:prstGeom>
          <a:solidFill><a:schemeClr val="accent3"><a:tint val="46000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="41" name="Frame Focus"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="8394720" y="3893820"/><a:ext cx="548640" cy="548640"/></a:xfrm>
          <a:prstGeom prst="frame">
            <a:avLst><a:gd name="adj1" fmla="?: 1 28000 12000"/></a:avLst>
          </a:prstGeom>
          <a:solidFill><a:schemeClr val="accent4"><a:tint val="36000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent4"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="42" name="Pie Slice"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="8229600" y="4625340"/><a:ext cx="640080" cy="640080"/></a:xfrm>
          <a:prstGeom prst="pie">
            <a:avLst>
              <a:gd name="adj1" fmla="*/ 8100000 4 2"/>
              <a:gd name="adj2" fmla="+/ 2400000 1200000 3"/>
            </a:avLst>
          </a:prstGeom>
          <a:solidFill><a:schemeClr val="accent1"><a:tint val="32000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="43" name="Chord Slice"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="7670800" y="3337560"/><a:ext cx="548640" cy="457200"/></a:xfrm>
          <a:prstGeom prst="chord">
            <a:avLst>
              <a:gd name="adj1" fmla="min 0 200000"/>
              <a:gd name="adj2" fmla="max 16200000 5400000"/>
            </a:avLst>
          </a:prstGeom>
          <a:solidFill><a:schemeClr val="accent2"><a:tint val="28000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="44" name="Donut Ring"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="8305800" y="3291840"/><a:ext cx="548640" cy="548640"/></a:xfrm>
          <a:prstGeom prst="donut">
            <a:avLst><a:gd name="adj" fmla="sqrt 1024000000"/></a:avLst>
          </a:prstGeom>
          <a:solidFill><a:schemeClr val="accent5"><a:tint val="30000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent5"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="45" name="Arc Sweep"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="7589520" y="4686300"/><a:ext cx="685800" cy="365760"/></a:xfrm>
          <a:prstGeom prst="arc">
            <a:avLst>
              <a:gd name="adj1" fmla="mod 0 0 16200000"/>
              <a:gd name="adj2" fmla="at2 0 1"/>
            </a:avLst>
          </a:prstGeom>
          <a:noFill/>
          <a:ln w="25400" cap="rnd"><a:solidFill><a:schemeClr val="accent6"/></a:solidFill><a:round/></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="46" name="Circular Loop"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="7040880" y="3025140"/><a:ext cx="640080" cy="640080"/></a:xfrm>
          <a:prstGeom prst="leftCircularArrow">
            <a:avLst>
              <a:gd name="adj1" fmla="abs -17000"/>
              <a:gd name="adj2" fmla="+- 0 0 3000000"/>
              <a:gd name="adj3" fmla="+- adj2 17400000 0"/>
              <a:gd name="adj4" fmla="+/ 4800000 0 2"/>
              <a:gd name="adj5" fmla="pin 0 5000 20000"/>
            </a:avLst>
          </a:prstGeom>
          <a:solidFill><a:schemeClr val="accent3"><a:tint val="26000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="47" name="Curved Forward Arrow"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="7589520" y="2834640"/><a:ext cx="1097280" cy="548640"/></a:xfrm>
          <a:prstGeom prst="curvedRightArrow">
            <a:avLst>
              <a:gd name="adj1" fmla="*/ 11000 4 2"/>
              <a:gd name="adj2" fmla="tan 30000 cd8"/>
              <a:gd name="adj3" fmla="cos 32000 0"/>
            </a:avLst>
          </a:prstGeom>
          <a:solidFill><a:schemeClr val="accent4"><a:tint val="33000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent4"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="48" name="Smiley Marker"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="8493120" y="2712720"/><a:ext cx="548640" cy="548640"/></a:xfrm>
          <a:prstGeom prst="smileyFace">
            <a:avLst><a:gd name="adj" fmla="cat2 5000 3 4"/></a:avLst>
          </a:prstGeom>
          <a:solidFill><a:schemeClr val="accent4"><a:tint val="45000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="35" name="Bevel Panel"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="7574280" y="4739640"/><a:ext cx="1143000" cy="434340"/></a:xfrm>
          <a:prstGeom prst="bevel">
            <a:avLst><a:gd name="adj" fmla="sat2 30000 3 4"/></a:avLst>
          </a:prstGeom>
          <a:solidFill><a:schemeClr val="accent5"><a:tint val="45000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent5"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="49" name="Chevron Tag"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="6134100" y="5646420"/><a:ext cx="1417320" cy="365760"/></a:xfrm>
          <a:prstGeom prst="chevron">
            <a:avLst><a:gd name="adj" fmla="max 20000 30000"/></a:avLst>
          </a:prstGeom>
          <a:solidFill><a:schemeClr val="accent6"><a:tint val="30000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent6"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="50" name="Skew Panel"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="4800600" y="5631180"/><a:ext cx="960120" cy="365760"/></a:xfrm>
          <a:prstGeom prst="parallelogram">
            <a:avLst><a:gd name="adj" fmla="min 32000 50000"/></a:avLst>
          </a:prstGeom>
          <a:solidFill><a:schemeClr val="accent3"><a:tint val="34000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="51" name="Process Trapezoid"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="7660800" y="5585460"/><a:ext cx="685800" cy="411480"/></a:xfrm>
          <a:prstGeom prst="trapezoid">
            <a:avLst><a:gd name="adj" fmla="?: 0 12000 22000"/></a:avLst>
          </a:prstGeom>
          <a:solidFill><a:schemeClr val="accent2"><a:tint val="28000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="52" name="Hex Node"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="8412480" y="5570220"/><a:ext cx="548640" cy="457200"/></a:xfrm>
          <a:prstGeom prst="hexagon">
            <a:avLst><a:gd name="adj" fmla="tan 28000 cd8"/></a:avLst>
          </a:prstGeom>
          <a:solidFill><a:schemeClr val="accent1"><a:tint val="36000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="53" name="Signal Triangle"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="5394960" y="6035040"/><a:ext cx="640080" cy="457200"/></a:xfrm>
          <a:prstGeom prst="triangle">
            <a:avLst><a:gd name="adj" fmla="sin 42000 cd4"/></a:avLst>
          </a:prstGeom>
          <a:solidFill><a:schemeClr val="accent4"><a:tint val="42000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent4"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="54" name="Plan Pentagon"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="6217920" y="5989320"/><a:ext cx="640080" cy="548640"/></a:xfrm>
          <a:prstGeom prst="pentagon"><a:avLst/></a:prstGeom>
          <a:solidFill><a:schemeClr val="accent5"><a:tint val="38000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent5"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="55" name="Decision Diamond"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="7056120" y="6050280"/><a:ext cx="548640" cy="365760"/></a:xfrm>
          <a:prstGeom prst="diamond"><a:avLst/></a:prstGeom>
          <a:solidFill><a:schemeClr val="accent2"><a:tint val="36000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
      <p:grpSp>
        <p:nvGrpSpPr>
          <p:cNvPr id="56" name="Mirrored Group"/>
          <p:cNvGrpSpPr/>
          <p:nvPr/>
        </p:nvGrpSpPr>
        <p:grpSpPr>
          <a:xfrm flipH="1">
            <a:off x="6858000" y="914400"/>
            <a:ext cx="1828800" cy="914400"/>
          </a:xfrm>
        </p:grpSpPr>
        <p:sp>
          <p:nvSpPr>
            <p:cNvPr id="57" name="Mirrored Arrow"/>
            <p:cNvSpPr/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="0" y="228600"/><a:ext cx="914400" cy="457200"/></a:xfrm>
            <a:prstGeom prst="rightArrow"><a:avLst/></a:prstGeom>
            <a:solidFill><a:schemeClr val="accent1"><a:tint val="38000"/></a:schemeClr></a:solidFill>
            <a:ln w="19050"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln>
          </p:spPr>
        </p:sp>
      </p:grpSp>`;

const UNSUPPORTED_SLIDE2_SHAPE = `      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="22" name="Unsupported Wedge Callout"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="4800600" y="4183380"/><a:ext cx="2514600" cy="640080"/></a:xfrm>
          <a:prstGeom prst="wedgeRoundRectCallout"><a:avLst/></a:prstGeom>
          <a:solidFill><a:schemeClr val="accent5"><a:tint val="45000"/></a:schemeClr></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:schemeClr val="accent5"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>`;

const slide3 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="Table Slide">
    <p:bg>
      <p:bgRef idx="1001">
        <a:schemeClr val="accent6"><a:alpha val="9000"/></a:schemeClr>
      </p:bgRef>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Table Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="685800" y="457200"/><a:ext cx="7772400" cy="685800"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr anchor="ctr"/>
          <a:lstStyle/>
          <a:p><a:r><a:rPr sz="2600" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>Table merges and placeholder-safe parsing</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:graphicFrame>
        <p:nvGraphicFramePr>
          <p:cNvPr id="3" name="Table 1"/>
          <p:cNvGraphicFramePr/>
          <p:nvPr/>
        </p:nvGraphicFramePr>
        <p:xfrm><a:off x="914400" y="1371600"/><a:ext cx="7315200" cy="1828800"/></p:xfrm>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
            <a:tbl>
              <a:tblPr firstRow="1" bandRow="1"/>
              <a:tblGrid>
                <a:gridCol w="2438400"/>
                <a:gridCol w="2438400"/>
                <a:gridCol w="2438400"/>
              </a:tblGrid>
              <a:tr h="457200">
                <a:tc>
                  <a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1500" b="1"><a:solidFill><a:schemeClr val="lt2"/></a:solidFill></a:rPr><a:t>Feature</a:t></a:r></a:p></a:txBody>
                  <a:tcPr anchor="ctr" marL="91440" marR="91440" marT="45720" marB="45720">
                    <a:solidFill><a:schemeClr val="accent1"/></a:solidFill>
                    <a:lnL w="12700"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:lnL>
                    <a:lnR w="12700"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:lnR>
                    <a:lnT w="12700"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:lnT>
                    <a:lnB w="12700"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:lnB>
                  </a:tcPr>
                </a:tc>
                <a:tc>
                  <a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1500" b="1"><a:solidFill><a:schemeClr val="lt2"/></a:solidFill></a:rPr><a:t>Coverage</a:t></a:r></a:p></a:txBody>
                  <a:tcPr gridSpan="2" anchor="ctr"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:tcPr>
                </a:tc>
                <a:tc>
                  <a:tcPr hMerge="1"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:tcPr>
                </a:tc>
              </a:tr>
              <a:tr h="457200">
                <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>Preview engine</a:t></a:r></a:p></a:txBody><a:tcPr rowSpan="2" anchor="ctr"/></a:tc>
                <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1400"><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></a:rPr><a:t>Supported</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
                <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>Text, shapes, media</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
              </a:tr>
              <a:tr h="457200">
                <a:tc><a:tcPr vMerge="1" anchor="ctr"/></a:tc>
                <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1400"><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></a:rPr><a:t>Merged cells</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
                <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>HTML rendering path</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
              </a:tr>
            </a:tbl>
          </a:graphicData>
        </a:graphic>
      </p:graphicFrame>
      __ACTION_LINK_SHAPE__
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;

const slide3Rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

const BODYPR_WRAP_ANCHOR_SLIDE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="BodyPr Wrap Anchor">
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="BodyPr Box"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="914400" y="914400"/><a:ext cx="4572000" cy="1371600"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:schemeClr val="accent1"><a:alpha val="12000"/></a:schemeClr></a:solidFill>
          <a:ln><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="none" anchor="ctr" anchorCtr="1" horzOverflow="clip" vertOverflow="clip" numCol="2" spcCol="182880" rtlCol="1" fromWordArt="1" lIns="91440" rIns="182880" tIns="45720" bIns="91440">
            <a:normAutofit fontScale="82000" lnSpcReduction="12000"/>
          </a:bodyPr>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"/>
            <a:r><a:rPr sz="2200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>Nowrap content should clip instead of wrapping into a new line.</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;

const SHAPE_TEXT_BOUNDS_SLIDE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="Shape Text Bounds">
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Arrow Label"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="457200" y="914400"/><a:ext cx="2057400" cy="914400"/></a:xfrm>
          <a:prstGeom prst="rightArrow"><a:avLst><a:gd name="adj1" fmla="val 42000"/><a:gd name="adj2" fmla="val 52000"/></a:avLst></a:prstGeom>
          <a:solidFill><a:schemeClr val="accent1"><a:tint val="25000"/></a:schemeClr></a:solidFill>
          <a:ln><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln>
        </p:spPr>
        <p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1800" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>Arrow CTA</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Diamond Label"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="2971800" y="914400"/><a:ext cx="1371600" cy="914400"/></a:xfrm>
          <a:prstGeom prst="diamond"><a:avLst/></a:prstGeom>
          <a:solidFill><a:schemeClr val="accent2"><a:tint val="28000"/></a:schemeClr></a:solidFill>
          <a:ln><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:ln>
        </p:spPr>
        <p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>Decision</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="4" name="Chevron Label"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="4800600" y="914400"/><a:ext cx="1828800" cy="914400"/></a:xfrm>
          <a:prstGeom prst="chevron"><a:avLst><a:gd name="adj" fmla="val 32000"/></a:avLst></a:prstGeom>
          <a:solidFill><a:schemeClr val="accent6"><a:tint val="26000"/></a:schemeClr></a:solidFill>
          <a:ln><a:solidFill><a:schemeClr val="accent6"/></a:solidFill></a:ln>
        </p:spPr>
        <p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>Process</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="5" name="Hex Label"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="6903720" y="914400"/><a:ext cx="1371600" cy="914400"/></a:xfrm>
          <a:prstGeom prst="hexagon"><a:avLst><a:gd name="adj" fmla="val 26000"/></a:avLst></a:prstGeom>
          <a:solidFill><a:schemeClr val="accent3"><a:tint val="25000"/></a:schemeClr></a:solidFill>
          <a:ln><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></a:ln>
        </p:spPr>
        <p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>Platform</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;

const TABLE_STYLE_TEXT_SLIDE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="Table Style Text">
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm>
      </p:grpSpPr>
      <p:graphicFrame>
        <p:nvGraphicFramePr>
          <p:cNvPr id="2" name="Styled Table"/>
          <p:cNvGraphicFramePr/>
          <p:nvPr/>
        </p:nvGraphicFramePr>
        <p:xfrm><a:off x="685800" y="914400"/><a:ext cx="7772400" cy="1828800"/></p:xfrm>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
            <a:tbl>
              <a:tblPr firstRow="1" firstCol="1" lastCol="1" bandRow="1">
                <a:tableStyleId>{11111111-1111-1111-1111-111111111111}</a:tableStyleId>
              </a:tblPr>
              <a:tblGrid>
                <a:gridCol w="2286000"/>
                <a:gridCol w="2286000"/>
                <a:gridCol w="3200400"/>
              </a:tblGrid>
              <a:tr h="457200">
                <a:tc>
                  <a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Tier</a:t></a:r></a:p></a:txBody>
                  <a:tcPr anchor="ctr"/>
                </a:tc>
                <a:tc>
                  <a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>SLA</a:t></a:r></a:p></a:txBody>
                  <a:tcPr anchor="ctr"/>
                </a:tc>
                <a:tc>
                  <a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Notes</a:t></a:r></a:p></a:txBody>
                  <a:tcPr anchor="ctr"/>
                </a:tc>
              </a:tr>
              <a:tr h="457200">
                <a:tc>
                  <a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Gold</a:t></a:r></a:p></a:txBody>
                  <a:tcPr anchor="ctr"/>
                </a:tc>
                <a:tc>
                  <a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>4 hours</a:t></a:r></a:p></a:txBody>
                  <a:tcPr anchor="ctr"/>
                </a:tc>
                <a:tc>
                  <a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr i="1"><a:solidFill><a:srgbClr val="C2410C"/></a:solidFill></a:rPr><a:t>Local override stays italic</a:t></a:r></a:p></a:txBody>
                  <a:tcPr anchor="ctr"/>
                </a:tc>
              </a:tr>
              <a:tr h="457200">
                <a:tc>
                  <a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Silver</a:t></a:r></a:p></a:txBody>
                  <a:tcPr anchor="ctr"/>
                </a:tc>
                <a:tc>
                  <a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Next day</a:t></a:r></a:p></a:txBody>
                  <a:tcPr anchor="ctr"/>
                </a:tc>
                <a:tc>
                  <a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Banded row style</a:t></a:r></a:p></a:txBody>
                  <a:tcPr anchor="ctr"/>
                </a:tc>
              </a:tr>
            </a:tbl>
          </a:graphicData>
        </a:graphic>
      </p:graphicFrame>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;

const TABLE_STYLE_TEXT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{11111111-1111-1111-1111-111111111111}">
  <a:tblStyle styleId="{11111111-1111-1111-1111-111111111111}" styleName="Preview Table Style">
    <a:wholeTbl>
      <a:tcStyle>
        <a:fill><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:fill>
        <a:tcBdr>
          <a:top w="12700"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:top>
          <a:right w="12700"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:right>
          <a:bottom w="12700"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:bottom>
          <a:left w="12700"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:left>
          <a:insideH w="12700"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:insideH>
          <a:insideV w="12700"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:insideV>
        </a:tcBdr>
      </a:tcStyle>
      <a:tcTxStyle sz="1600" algn="ctr">
        <a:fontRef idx="minor"/>
        <a:schemeClr val="tx1"/>
      </a:tcTxStyle>
    </a:wholeTbl>
    <a:firstRow>
      <a:tcStyle>
        <a:fill><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></a:fill>
      </a:tcStyle>
      <a:tcTxStyle b="1" sz="2000" algn="ctr">
        <a:fontRef idx="major"/>
        <a:schemeClr val="lt1"/>
      </a:tcTxStyle>
    </a:firstRow>
    <a:band1H>
      <a:tcStyle>
        <a:fill><a:solidFill><a:schemeClr val="accent6"><a:alpha val="8000"/></a:schemeClr></a:solidFill></a:fill>
      </a:tcStyle>
      <a:tcTxStyle sz="1500" algn="l">
        <a:fontRef idx="minor"/>
        <a:schemeClr val="tx1"/>
      </a:tcTxStyle>
    </a:band1H>
    <a:firstCol>
      <a:tcTxStyle b="1" sz="1700" algn="ctr">
        <a:fontRef idx="major"/>
        <a:schemeClr val="accent2"/>
      </a:tcTxStyle>
    </a:firstCol>
    <a:lastCol>
      <a:tcTxStyle u="sng" algn="ctr">
        <a:fontRef idx="minor"/>
        <a:schemeClr val="accent1"/>
      </a:tcTxStyle>
    </a:lastCol>
  </a:tblStyle>
</a:tblStyleLst>`;

function createBaseZip() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rootRels);
  zip.file('docProps/core.xml', coreProps);
  zip.file('docProps/app.xml', appProps);
  zip.file('ppt/presentation.xml', presentation);
  zip.file('ppt/_rels/presentation.xml.rels', presentationRels);
  zip.file('ppt/slideMasters/slideMaster1.xml', slideMaster);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', slideMasterRels);
  zip.file('ppt/slideLayouts/slideLayout1.xml', slideLayout);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', slideLayoutRels);
  zip.file('ppt/theme/theme1.xml', theme);
  zip.file('ppt/slides/slide1.xml', slide1);
  zip.file('ppt/slides/_rels/slide1.xml.rels', slide1Rels);
  zip.file('ppt/slides/slide2.xml', slide2);
  zip.file('ppt/slides/_rels/slide2.xml.rels', slide2Rels);
  zip.file('ppt/slides/slide3.xml', slide3);
  zip.file('ppt/slides/_rels/slide3.xml.rels', slide3Rels);
  zip.file('ppt/media/image1.png', IMAGE_PNG_BASE64, { base64: true });
  return zip;
}

async function writeFixture(targetPath, slides, options = {}) {
  const zip = createBaseZip();
  const extraSlide2Shapes = options.extraSlide2Shapes ?? SUPPORTED_SLIDE2_SHAPES;
  const includeNavigationLinks = slides.includes(1) && slides.includes(3);
  const includeImageLink = slides.includes(2) && slides.includes(3);
  const includeGroupedShapeLink = slides.includes(2);
  const internalLinkParagraph = includeNavigationLinks
    ? `          <a:p>
            <a:r>
              <a:rPr sz="1700" u="sng">
                <a:solidFill><a:schemeClr val="accent2"/></a:solidFill>
                <a:hlinkClick r:id="rId3" action="ppaction://hlinksldjump"/>
              </a:rPr>
              <a:t>Jump to table slide</a:t>
            </a:r>
          </a:p>`
    : '';
  const internalLinkRel = includeNavigationLinks
    ? '  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide3.xml"/>'
    : '';
  const actionLinkShape = includeNavigationLinks
    ? `      <p:sp>
        <p:nvSpPr><p:cNvPr id="10" name="Navigation Actions"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="914400" y="3429000"/><a:ext cx="7315200" cy="548640"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr sz="1600" u="sng">
                <a:solidFill><a:schemeClr val="accent2"/></a:solidFill>
                <a:hlinkClick action="ppaction://hlinkshowjump?jump=firstslide"/>
              </a:rPr>
              <a:t>Back to first slide</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="1600" u="sng">
                <a:solidFill><a:schemeClr val="accent1"/></a:solidFill>
                <a:hlinkClick action="ppaction://hlinkshowjump?jump=lastslideviewed"/>
              </a:rPr>
              <a:t>Return to last viewed slide</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>`
    : '';
  const imageLinkMarkup = includeImageLink
    ? '<a:hlinkClick r:id="rId3" action="ppaction://hlinksldjump"/>'
    : '';
  const imageLinkRel = includeImageLink
    ? '  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide3.xml"/>'
    : '';
  const groupedShapeLinkMarkup = includeGroupedShapeLink ? '<a:hlinkClick r:id="rId4"/>' : '';
  const groupedShapeLinkRel = includeGroupedShapeLink
    ? `  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${GROUPED_MEDIA_EXTERNAL_URL}" TargetMode="External"/>`
    : '';

  zip.file('ppt/slides/slide1.xml', slide1.replace('__INTERNAL_LINK_PARAGRAPH__', internalLinkParagraph));
  zip.file('ppt/slides/_rels/slide1.xml.rels', slide1Rels.replace('__INTERNAL_LINK_REL__', internalLinkRel));
  zip.file(
    'ppt/slides/slide2.xml',
    slide2
      .replace('__IMAGE_LINK__', imageLinkMarkup)
      .replace('__GROUP_SHAPE_LINK__', groupedShapeLinkMarkup)
      .replace('__EXTRA_SLIDE2_SHAPES__', extraSlide2Shapes)
  );
  zip.file(
    'ppt/slides/_rels/slide2.xml.rels',
    slide2Rels.replace('__IMAGE_LINK_REL__', imageLinkRel).replace('__GROUP_SHAPE_LINK_REL__', groupedShapeLinkRel)
  );
  zip.file('ppt/slides/slide3.xml', slide3.replace('__ACTION_LINK_SHAPE__', actionLinkShape));

  if (options.slideOverrides) {
    for (const [slideNumber, xml] of Object.entries(options.slideOverrides)) {
      zip.file(`ppt/slides/slide${slideNumber}.xml`, xml);
    }
  }
  if (options.slideRelationshipOverrides) {
    for (const [slideNumber, xml] of Object.entries(options.slideRelationshipOverrides)) {
      zip.file(`ppt/slides/_rels/slide${slideNumber}.xml.rels`, xml);
    }
  }
  if (options.extraFiles) {
    for (const [filePath, content] of Object.entries(options.extraFiles)) {
      zip.file(filePath, content);
    }
  }

  if (!slides.includes(1)) {
    zip.remove('ppt/slides/slide1.xml');
    zip.remove('ppt/slides/_rels/slide1.xml.rels');
  }
  if (!slides.includes(2)) {
    zip.remove('ppt/slides/slide2.xml');
    zip.remove('ppt/slides/_rels/slide2.xml.rels');
  }
  if (!slides.includes(3)) {
    zip.remove('ppt/slides/slide3.xml');
    zip.remove('ppt/slides/_rels/slide3.xml.rels');
  }

  const slideIdList = slides
    .map((slideNumber, index) => `    <p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`)
    .join('\n');
  const relList = slides
    .map(
      (slideNumber, index) =>
        `  <Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${slideNumber}.xml"/>`
    )
    .join('\n');

  zip.file(
    'ppt/presentation.xml',
    presentation.replace(
      /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
      `<p:sldIdLst>\n${slideIdList}\n  </p:sldIdLst>`
    )
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>\n${relList}\n</Relationships>`
  );

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await fs.writeFile(targetPath, buffer);
}

await writeFixture(OUTPUTS.sampleDeck, [1, 2, 3]);
await writeFixture(OUTPUTS.textTheme, [1]);
await writeFixture(OUTPUTS.groupedMedia, [2]);
await writeFixture(OUTPUTS.tableFixture, [3]);
await writeFixture(OUTPUTS.unsupportedShape, [2], { extraSlide2Shapes: UNSUPPORTED_SLIDE2_SHAPE });
await writeFixture(OUTPUTS.shapeTextBounds, [2], {
  slideOverrides: {
    2: SHAPE_TEXT_BOUNDS_SLIDE
  }
});
await writeFixture(OUTPUTS.tableStyleText, [3], {
  slideOverrides: {
    3: TABLE_STYLE_TEXT_SLIDE
  },
  extraFiles: {
    'ppt/tableStyles.xml': TABLE_STYLE_TEXT_XML
  }
});
await writeFixture(OUTPUTS.bodyPrWrapAnchor, [1], {
  slideOverrides: {
    1: BODYPR_WRAP_ANCHOR_SLIDE
  }
});
