// Deterministic, uncompressed PDF with varying page sizes, vector art and searchable text.
export function createPdfFixture(pageCount = 100, mixedSizes = false) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const pages = [];
  for (let index = 0; index < pageCount; index++) {
    const width = mixedSizes && index % 3 === 1 ? 800 : 600;
    const height = mixedSizes && index % 3 === 1 ? 600 : mixedSizes && index % 3 === 2 ? 1000 : 800;
    const pageId = objects.length + 1;
    pages.push(`${pageId} 0 R`);
    const art = Array.from({ length: 60 }, (_, item) => {
      const x = 40 + (item % 6) * 80, y = 90 + Math.floor(item / 6) * 36;
      return `${(item % 7) / 7} 0.4 0.7 rg ${x} ${y} 62 22 re f`;
    }).join('\n');
    const stream = `0.08 0.18 0.3 rg 0 0 ${width} ${height} re f\n${art}\n1 1 1 rg BT /F1 24 Tf 40 ${height - 60} Td (Document page ${index + 1}) Tj ET\n`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  }
  objects[1] = `<< /Type /Pages /Count ${pageCount} /Kids [${pages.join(' ')}] >>`;
  let text = '%PDF-1.4\n', offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}
