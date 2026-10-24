export function createDrawioFixture(nodeCount, htmlLabels = false) {
  const nodes = Array.from({ length: nodeCount }, (_, index) => `<mxCell id="n${index}" vertex="1" value="${htmlLabels ? '&lt;b&gt;Task&lt;/b&gt; &amp;amp; 中文 ' : 'Task '}${index}" style="rounded=1;fillColor=#dae8fc"><mxGeometry x="${index % 50 * 180}" y="${Math.floor(index / 50) * 100}" width="120" height="60"/></mxCell>`).join('');
  return `<mxfile><diagram id="flow" name="Flow"><mxGraphModel><root>${nodes}</root></mxGraphModel></diagram></mxfile>`;
}

export function createVisioPage(shapeCount) {
  const shapes = Array.from({ length: shapeCount }, (_, index) => `<Shape ID="${index + 1}" Type="Shape"><Text>Task ${index} 中文</Text>` +
    [['PinX', index % 50 * 2 + 1], ['PinY', Math.floor(index / 50) + 1], ['Width', 1.2], ['Height', 0.6],
      ['LocPinX', 0.6], ['LocPinY', 0.3], ['Angle', 0], ['FlipX', 0], ['FlipY', 0], ['ResizeMode', 0],
      ['LinePattern', 1], ['LineWeight', 0.01], ['FillPattern', 1], ['FillBkgnd', '#ffffff'], ['FillForegnd', '#dae8fc'],
      ['LineColor', '#6c8ebf'], ['LayerMember', 0], ['NoFill', 0], ['NoLine', 0], ['HideText', 0],
      ['TxtPinX', 0.6], ['TxtPinY', 0.3], ['TxtWidth', 1.2], ['TxtHeight', 0.6]]
      .map(([name, value]) => `<Cell N="${name}" V="${value}"/>`).join('') + '</Shape>').join('');
  return `<PageContents><PageSheet><Cell N="PageHeight" V="60"/></PageSheet><Shapes>${shapes}</Shapes></PageContents>`;
}

export const legacyVdxFixture = `<VisioDocument xmlns="http://schemas.microsoft.com/visio/2003/core"><Pages><Page ID="0" NameU="Legacy Flow">
  <PageSheet><PageProps><PageWidth>8.5</PageWidth><PageHeight>5</PageHeight></PageProps></PageSheet><Shapes>
    <Shape ID="1" Type="Shape"><XForm><PinX>1.5</PinX><PinY>3.5</PinY><Width>1.2</Width><Height>0.6</Height></XForm><Fill><FillForegnd>#dae8fc</FillForegnd></Fill><Line><LineColor>#6c8ebf</LineColor></Line><Text>Start</Text></Shape>
    <Shape ID="2" Type="Shape"><XForm><PinX>4.5</PinX><PinY>3.5</PinY><Width>1.2</Width><Height>0.6</Height></XForm><Text>Done</Text></Shape>
    <Shape ID="3" Type="Shape"><XForm1D><BeginX>2.1</BeginX><BeginY>3.5</BeginY><EndX>3.9</EndX><EndY>3.5</EndY></XForm1D><Text>Next</Text></Shape>
  </Shapes><Connects><Connect FromSheet="3" FromCell="BeginX" ToSheet="1"/><Connect FromSheet="3" FromCell="EndX" ToSheet="2"/></Connects>
</Page></Pages></VisioDocument>`;
