import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import {
  approvalSchema,
  cvSchema,
  type Cv,
  type ExportApproval,
} from './schema.js';

export { approvalSchema, cvSchema } from './schema.js';
export type { Cv, ExportApproval } from './schema.js';
export {
  renderPdf,
  extractPdfText,
  assertExtractedText,
  convertDocxToPdf,
} from './gotenberg.js';

export function assertApproved(cv: Cv, approval: ExportApproval): void {
  approvalSchema.parse(approval);
  if (approval.cvVersionId !== approval.approvedVersionId)
    throw new Error('CV version is not approved');
  const decisions = new Map(
    approval.embellishments.map((entry) => [entry.id, entry]),
  );
  if (decisions.size !== approval.embellishments.length)
    throw new Error('Duplicate embellishment decision');
  const referenced = new Set(
    cv.experience.flatMap((role) =>
      role.projects.flatMap((project) =>
        project.bullets.flatMap((bullet) =>
          bullet.embellishmentId ? [bullet.embellishmentId] : [],
        ),
      ),
    ),
  );
  for (const decision of decisions.values()) {
    if (decision.status === 'rejected' && !referenced.has(decision.id))
      continue;
    if (
      decision.status !== 'approved' ||
      !decision.lineApproved ||
      !decision.defenseEntryId ||
      decision.defenseScore === null ||
      decision.defenseScore < 4 ||
      decision.criticalFindings !== 0
    ) {
      throw new Error('Unapproved or undefended CV change');
    }
  }
  for (const experience of cv.experience)
    for (const project of experience.projects)
      for (const bullet of project.bullets) {
        if (bullet.embellishmentId && !decisions.has(bullet.embellishmentId)) {
          throw new Error('Missing CV line approval');
        }
      }
}

export function cvLines(cv: Cv): string[] {
  const lines = [
    cv.basics.name,
    cv.basics.headline,
    cv.basics.location,
    cv.basics.contact,
    'Summary',
    cv.summary.en,
    cv.summary.vi,
    'Experience',
  ];
  for (const role of cv.experience) {
    lines.push(
      `${role.companyAlias} - ${role.title} (${role.start} - ${role.end ?? 'Present'})`,
    );
    for (const project of role.projects) {
      lines.push(project.alias, `Stack: ${project.stack.join(', ')}`);
      for (const bullet of project.bullets)
        lines.push(bullet.text.en, bullet.text.vi);
    }
  }
  lines.push('Skills');
  for (const skill of cv.skills)
    lines.push(`${skill.group}: ${skill.items.join(', ')}`);
  lines.push('Education');
  for (const item of cv.education)
    lines.push(`${item.institution} - ${item.qualification} (${item.year})`);
  return lines;
}

const defaultTemplate = fileURLToPath(
  new URL('../templates/ats-classic.docx', import.meta.url),
);

export async function renderDocx(
  input: unknown,
  approval: ExportApproval,
  templatePath = defaultTemplate,
): Promise<Buffer> {
  const cv = cvSchema.parse(input);
  assertApproved(cv, approval);
  const template = await readFile(templatePath);
  const doc = new Docxtemplater(new PizZip(template), {
    paragraphLoop: true,
    linebreaks: true,
  });
  doc.render({
    ...cv.basics,
    summaryEn: cv.summary.en,
    summaryVi: cv.summary.vi,
    experience: cv.experience.map((role) => ({
      ...role,
      roleLine: `${role.companyAlias} - ${role.title} (${role.start} - ${role.end ?? 'Present'})`,
      projects: role.projects.map((project) => ({
        ...project,
        stackLine: `Stack: ${project.stack.join(', ')}`,
        bullets: project.bullets.map((bullet) => ({
          en: bullet.text.en,
          vi: bullet.text.vi,
        })),
      })),
    })),
    skills: cv.skills.map((skill) => ({
      line: `${skill.group}: ${skill.items.join(', ')}`,
    })),
    education: cv.education.map((item) => ({
      line: `${item.institution} - ${item.qualification} (${item.year})`,
    })),
  });
  return doc.toBuffer();
}
