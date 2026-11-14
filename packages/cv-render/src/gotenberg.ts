import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cvSchema, type Cv, type ExportApproval } from './schema.js';
import { cvLines, renderDocx } from './index.js';

export type PdfFallback = (
  cv: Cv,
  docx: Buffer,
  reason: Error,
) => Promise<Buffer>;

export async function extractPdfText(pdf: Buffer): Promise<string> {
  const task = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
  const document = await task.promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items.map((item) => ('str' in item ? item.str : '')).join(' '),
      );
    }
    return pages.join(' ');
  } finally {
    await task.destroy();
  }
}

export function assertExtractedText(text: string, cv: Cv): void {
  const normalize = (value: string) =>
    value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const extracted = normalize(text);
  let position = 0;
  for (const line of cvLines(cv)) {
    const found = extracted.indexOf(normalize(line), position);
    if (found < 0 || extracted.slice(position, found).trim())
      throw new Error(
        'PDF text differs from approved DOCX content or section order',
      );
    position = found + normalize(line).length;
  }
  if (extracted.slice(position).trim())
    throw new Error('PDF has unexpected text after the CV');
}

export async function convertDocxToPdf(
  docx: Buffer,
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<Buffer> {
  const form = new FormData();
  form.append(
    'files',
    new Blob([new Uint8Array(docx)], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    'cv.docx',
  );
  const response = await fetcher(new URL('/forms/libreoffice/convert', url), {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (
    !response.ok ||
    !response.headers
      .get('content-type')
      ?.toLowerCase()
      .includes('application/pdf')
  ) {
    throw new Error(`Gotenberg conversion failed (HTTP ${response.status})`);
  }
  const pdf = Buffer.from(await response.arrayBuffer());
  if (pdf.subarray(0, 5).toString() !== '%PDF-')
    throw new Error('Gotenberg returned invalid PDF bytes');
  return pdf;
}

export async function renderPdf(
  input: unknown,
  approval: ExportApproval,
  options: {
    gotenbergUrl?: string;
    fallback?: PdfFallback;
    fetcher?: typeof fetch;
    validateLayout?: (pdf: Buffer, cv: Cv) => Promise<void>;
  } = {},
): Promise<{ pdf: Buffer; route: 'libreoffice' | 'fallback' }> {
  const cv = cvSchema.parse(input);
  const docx = await renderDocx(cv, approval);
  try {
    const url = options.gotenbergUrl ?? process.env.GOTENBERG_URL;
    if (!url) throw new Error('GOTENBERG_URL is required for PDF conversion');
    const pdf = await convertDocxToPdf(docx, url, options.fetcher);
    assertExtractedText(await extractPdfText(pdf), cv);
    await options.validateLayout?.(pdf, cv);
    return { pdf, route: 'libreoffice' };
  } catch (error) {
    if (!options.fallback)
      throw new Error('PDF export failed; no verified fallback is available', {
        cause: error,
      });
    const pdf = await options.fallback(
      cv,
      docx,
      error instanceof Error ? error : new Error(String(error)),
    );
    if (pdf.subarray(0, 5).toString() !== '%PDF-')
      throw new Error('Fallback returned invalid PDF bytes');
    assertExtractedText(await extractPdfText(pdf), cv);
    await options.validateLayout?.(pdf, cv);
    return { pdf, route: 'fallback' };
  }
}
