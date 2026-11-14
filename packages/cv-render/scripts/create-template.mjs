import { writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import PizZip from 'pizzip';

const escapeXml = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
const paragraph = (tag, style = 'Normal') =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(tag)}</w:t></w:r></w:p>`;
const body = [
  paragraph('{name}', 'Title'),
  paragraph('{headline}'),
  paragraph('{location}'),
  paragraph('{contact}'),
  paragraph('Summary', 'Heading1'),
  paragraph('{summaryEn}'),
  paragraph('{summaryVi}'),
  paragraph('Experience', 'Heading1'),
  paragraph('{#experience}'),
  paragraph('{roleLine}', 'Heading2'),
  paragraph('{#projects}'),
  paragraph('{alias}', 'Heading3'),
  paragraph('{stackLine}'),
  paragraph('{#bullets}'),
  paragraph('{en}', 'ListParagraph'),
  paragraph('{vi}', 'ListParagraph'),
  paragraph('{/bullets}'),
  paragraph('{/projects}'),
  paragraph('{/experience}'),
  paragraph('Skills', 'Heading1'),
  paragraph('{#skills}'),
  paragraph('{line}'),
  paragraph('{/skills}'),
  paragraph('Education', 'Heading1'),
  paragraph('{#education}'),
  paragraph('{line}'),
  paragraph('{/education}'),
].join('');

const zip = new PizZip();
zip.file(
  '[Content_Types].xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/></Types>`,
);
zip.file(
  '_rels/.rels',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
);
zip.file(
  'word/_rels/document.xml.rels',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>`,
);
zip.file(
  'word/document.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1100" w:bottom="1000" w:left="1100"/></w:sectPr></w:body></w:document>`,
);
zip.file(
  'word/styles.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Noto Sans" w:hAnsi="Noto Sans" w:eastAsia="Noto Sans" w:cs="Noto Sans"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>${[
    ['Normal', 20, 0],
    ['Title', 32, 1],
    ['Heading1', 24, 1],
    ['Heading2', 21, 1],
    ['Heading3', 20, 1],
    ['ListParagraph', 20, 0],
  ]
    .map(
      ([id, size, bold]) =>
        `<w:style w:type="paragraph" w:styleId="${id}"${id === 'Normal' ? ' w:default="1"' : ''}><w:name w:val="${id}"/><w:pPr><w:spacing w:after="100"/></w:pPr><w:rPr><w:rFonts w:ascii="Noto Sans" w:hAnsi="Noto Sans"/><w:sz w:val="${size}"/>${bold ? '<w:b/>' : ''}</w:rPr></w:style>`,
    )
    .join('')}</w:styles>`,
);
zip.file(
  'word/fontTable.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:font w:name="Noto Sans"><w:family w:val="swiss"/></w:font></w:fonts>`,
);
await writeFile(
  fileURLToPath(new URL('../templates/ats-classic.docx', import.meta.url)),
  zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }),
);
