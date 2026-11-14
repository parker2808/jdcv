import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mammoth from 'mammoth';
import { describe, expect, it } from 'vitest';
import {
  assertExtractedText,
  convertDocxToPdf,
  cvLines,
  cvSchema,
  renderDocx,
  renderPdf,
  type Cv,
  type ExportApproval,
} from './index.js';

const fixturePath = fileURLToPath(
  new URL('../fixtures/alex-example.json', import.meta.url),
);
const cv = cvSchema.parse(JSON.parse(await readFile(fixturePath, 'utf8')));
const approval: ExportApproval = {
  cvVersionId: 'v1',
  approvedVersionId: 'v1',
  embellishments: [],
};

describe('CV export', () => {
  it('fills the tagged Word template and preserves ATS text and Vietnamese accents', async () => {
    const docx = await renderDocx(cv, approval);
    expect(docx.subarray(0, 2).toString()).toBe('PK');
    const extracted = await mammoth.extractRawText({ buffer: docx });
    expect(extracted.value).toContain('Cải thiện thao tác bằng bàn phím');
    assertExtractedText(extracted.value, cv);
    expect(cvLines(cv).indexOf('Summary')).toBeLessThan(
      cvLines(cv).indexOf('Experience'),
    );
  });

  it('rejects invalid versions, missing or pending approvals, and weak defences', async () => {
    await expect(
      renderDocx(cv, { ...approval, approvedVersionId: 'v2' }),
    ).rejects.toThrow('not approved');
    const changed: Cv = structuredClone(cv);
    changed.experience[0].projects[0].bullets[0].embellishmentId = 'e1';
    await expect(renderDocx(changed, approval)).rejects.toThrow(
      'Missing CV line approval',
    );
    const decision = {
      id: 'e1',
      status: 'approved' as const,
      lineApproved: true,
      defenseEntryId: 'd1',
      defenseScore: 4,
      criticalFindings: 0,
    };
    await expect(
      renderDocx(changed, {
        ...approval,
        embellishments: [{ ...decision, status: 'proposed' }],
      }),
    ).rejects.toThrow('Unapproved');
    await expect(
      renderDocx(changed, {
        ...approval,
        embellishments: [{ ...decision, defenseScore: 3 }],
      }),
    ).rejects.toThrow('Unapproved');
    await expect(
      renderDocx(changed, {
        ...approval,
        embellishments: [{ ...decision, criticalFindings: 1 }],
      }),
    ).rejects.toThrow('Unapproved');
    await expect(
      renderDocx(changed, { ...approval, embellishments: [decision] }),
    ).resolves.toBeInstanceOf(Buffer);
    await expect(
      renderDocx(cv, {
        ...approval,
        embellishments: [{ ...decision, status: 'rejected' }],
      }),
    ).resolves.toBeInstanceOf(Buffer);
    await expect(
      renderDocx(changed, {
        ...approval,
        embellishments: [{ ...decision, status: 'rejected' }],
      }),
    ).rejects.toThrow('Unapproved');
  });

  it('refuses a failed conversion and an unverified fallback', async () => {
    const failed = async () =>
      new Response('conversion failed', { status: 500 });
    await expect(
      renderPdf(cv, approval, {
        gotenbergUrl: 'http://localhost:3000',
        fetcher: failed,
      }),
    ).rejects.toThrow('no verified fallback');
    await expect(
      renderPdf(cv, approval, {
        gotenbergUrl: 'http://localhost:3000',
        fetcher: failed,
        fallback: async () => Buffer.from('not a pdf'),
      }),
    ).rejects.toThrow('invalid PDF');
    await expect(
      convertDocxToPdf(
        Buffer.from('fake'),
        'http://localhost:3000',
        async () =>
          new Response('not a pdf', {
            headers: { 'content-type': 'application/pdf' },
          }),
      ),
    ).rejects.toThrow('invalid PDF');
  });

  it('refuses missing, reordered or additional extracted claims', () => {
    expect(() =>
      assertExtractedText(
        cvLines(cv).join(' ').replace('bàn phím', 'ban phim'),
        cv,
      ),
    ).toThrow();
    const reordered = cvLines(cv);
    [reordered[4], reordered[7]] = [reordered[7], reordered[4]];
    expect(() => assertExtractedText(reordered.join(' '), cv)).toThrow();
    expect(() =>
      assertExtractedText(`${cvLines(cv).join(' ')} invented claim`, cv),
    ).toThrow();
  });
});

it.skipIf(!process.env.GOTENBERG_URL)(
  'converts the generated DOCX to an ATS-readable PDF in CI',
  async () => {
    const docx = await renderDocx(cv, approval);
    const pdf = await convertDocxToPdf(docx, process.env.GOTENBERG_URL!);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const rendered = await renderPdf(cv, approval);
    expect(rendered.route).toBe('libreoffice');
    const fallback = await renderPdf(cv, approval, {
      fetcher: async () => new Response('conversion failed', { status: 500 }),
      fallback: async () => pdf,
    });
    expect(fallback.route).toBe('fallback');
    await expect(
      renderPdf(cv, approval, {
        validateLayout: async () => {
          throw new Error('Layout check failed');
        },
        fallback: async () => pdf,
      }),
    ).rejects.toThrow('Layout check failed');
    let checks = 0;
    const recovered = await renderPdf(cv, approval, {
      validateLayout: async () => {
        if (++checks === 1) throw new Error('Layout check failed');
      },
      fallback: async () => pdf,
    });
    expect(recovered.route).toBe('fallback');
    expect(checks).toBe(2);
  },
);
