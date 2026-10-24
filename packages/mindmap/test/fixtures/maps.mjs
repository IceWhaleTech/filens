export function createWideMmFixture(nodeCount, explicitIds = false) {
  const id = index => explicitIds ? ` ID="node-${index}"` : '';
  return `<map version="1.0.1"><node${id(0)} TEXT="Wide plan">${Array.from({ length: nodeCount - 1 }, (_, index) =>
    `<node${id(index + 1)} TEXT="Task ${index + 1}"/>`).join('')}</node></map>`;
}

export const mixedMmFixture = `<wrapper xmlns:m="urn:freemind"><map>
  <attribute NAME="version" VALUE="1"/>
  <m:node TEXT="  Mixed   tree "><icon BUILTIN="idea"/>
    <node ID="known" TEXT="First"><node TEXT="Nested"/></node>
    <attribute NAME="note" VALUE="ignore"/>
    <m:NODE TEXT="Second"><node TEXT="Last"/></m:NODE>
  </m:node>
</map></wrapper>`;

export async function createPackagedMapFixtures(JSZip) {
  const packs = [
    { name: 'xmind-json', format: 'xmind', entry: 'content.json', content: JSON.stringify([{ rootTopic: {
      id: 'root', title: 'Plan 中文', children: { attached: [
        { id: 'first', title: 'First' }, { id: 'second', title: 'Second', children: { attached: [{ id: 'last', title: 'Last' }] } }
      ] }
    } }]) },
    { name: 'xmind-xml', format: 'xmind', entry: 'content.xml', content: '<xmap-content><sheet><topic id="root"><title>Plan 中文</title><children><topics type="attached"><topic id="first"><title>First</title></topic><topic id="second"><title>Second</title><children><topics type="attached"><topic id="last"><title>Last</title></topic></topics></children></topic></topics></children></topic></sheet></xmap-content>' },
    { name: 'mindmanager', format: 'mmap', entry: 'Document.xml', content: '<Map><Topic Id="root" Text="Plan 中文"><SubTopics><Topic Id="first" Text="First"/><Topic Id="second" Text="Second"><SubTopics><Topic Id="last" Text="Last"/></SubTopics></Topic></SubTopics></Topic></Map>' }
  ];
  return Promise.all(packs.map(async ({ name, format, entry, content }) => {
    const zip = new JSZip(); zip.file(entry, content, { date: new Date('2000-01-01T00:00:00Z') });
    return { name, format, bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }) };
  }));
}
