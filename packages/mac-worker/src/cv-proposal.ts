import { readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import mammoth from 'mammoth';
import { z } from 'zod';
import {
  cvSchema,
  assertApproved,
  renderDocx,
  renderPdf,
  type Cv,
  type ExportApproval,
} from '@jdcv/cv-render';
import {
  checkPlausibility,
  canProposeEmbellishments,
  generatorPrompt,
  type ProposedChange,
} from '@jdcv/prompts';
import { runGates, type CvFacts, type OwnerRules } from '@jdcv/gates';
import type { ModuleV2 } from '@jdcv/contracts';
import type { Examination, ReadabilityResult } from '@jdcv/prompts';
import { extractPdfText } from '@jdcv/cv-render';
import { PrivateCvError } from './cv-source-error.js';
import { loadPortfolioCv } from './portfolio-cv-source.js';

export { PrivateCvError } from './cv-source-error.js';

const factSchema = z
  .object({
    kind: z.enum([
      'role',
      'employer',
      'date',
      'project',
      'skill',
      'achievement',
    ]),
    value: z.string().min(1),
    sourceRef: z.string().regex(/^cv:paragraph:\d+$/),
  })
  .strict();

const changeSchema = z
  .object({
    id: z.string().min(1),
    path: z
      .string()
      .regex(/^experience\.\d+\.projects\.\d+\.bullets\.\d+\.text\.(en|vi)$/),
    before: z.string().min(1),
    after: z.string().min(1),
    reason: z.string().min(1),
    requirementId: z.string().min(1),
    sourceRef: z.string().regex(/^cv:paragraph:\d+$/),
    risk: z.enum(['low', 'medium', 'high']),
    riskNote: z.string().min(1),
    interviewAnswer: z.string().min(1),
    defenseEntryId: z.string().min(1),
    change: z.custom<ProposedChange>(
      (value) => typeof value === 'object' && value !== null,
    ),
    embellishment: z.boolean(),
    decision: z.enum(['pending', 'approved', 'rejected']),
    defenseScore: z.number().min(0).max(5).nullable(),
    criticalFindings: z.number().int().nonnegative(),
  })
  .strict();

export const cvProposalSchema = z
  .object({
    version: z.literal(1),
    state: z.literal('awaiting_owner_approval'),
    cvVersionId: z.string().min(1),
    cv: cvSchema,
    facts: z.array(factSchema),
    lines: z.array(changeSchema),
  })
  .strict();

export type CvProposal = z.infer<typeof cvProposalSchema>;
export type OwnerDecision = { id: string; decision: 'approved' | 'rejected' };

function inside(path: string, parent: string): boolean {
  const remainder = relative(parent, path);
  return !remainder.startsWith('..') && !isAbsolute(remainder);
}

export async function loadPrivateCv(
  directory: string | undefined,
  repoRoot: string,
): Promise<{ paragraphs: string[]; source: string }> {
  const selected = directory ?? join(homedir(), 'ai-tools', 'jdcv-private');
  if (!isAbsolute(selected)) throw new PrivateCvError('CV_SOURCE_UNSAFE');
  const repo = await realpath(repoRoot);
  const privateDir = await realpath(selected).catch(() => {
    throw new PrivateCvError('CV_SOURCE_MISSING');
  });
  if (inside(privateDir, repo) || inside(repo, privateDir))
    throw new PrivateCvError('CV_SOURCE_UNSAFE');
  const entries = await readdir(privateDir, { withFileTypes: true });
  const candidates = entries.filter((entry) =>
    /\.(docx|pdf)$/i.test(entry.name),
  );
  if (!candidates.length) throw new PrivateCvError('CV_SOURCE_MISSING');
  if (candidates.length !== 1) throw new PrivateCvError('CV_SOURCE_AMBIGUOUS');
  const entry = candidates[0]!;
  if (!entry.isFile()) throw new PrivateCvError('CV_SOURCE_UNSAFE');
  if (!entry.name.toLowerCase().endsWith('.docx'))
    throw new PrivateCvError('CV_SOURCE_UNSUPPORTED');
  const source = join(privateDir, entry.name);
  if (
    !inside(await realpath(source), privateDir) ||
    (await stat(source)).size > 10_000_000
  )
    throw new PrivateCvError('CV_SOURCE_UNSAFE');
  const result = await mammoth.extractRawText({
    buffer: await readFile(source),
  });
  const paragraphs = result.value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!paragraphs.length) throw new PrivateCvError('CV_SOURCE_MISSING');
  return { paragraphs, source };
}

export function validateGrounding(
  proposal: CvProposal,
  paragraphs: readonly string[],
  jd: string,
): void {
  const citation = (ref: string) =>
    paragraphs[Number(ref.slice('cv:paragraph:'.length)) - 1];
  if (!proposal.facts.length || !proposal.cv.experience.length)
    throw new Error('CV facts are required');
  for (const fact of proposal.facts) {
    if (!citation(fact.sourceRef)?.includes(fact.value))
      throw new Error('CV fact lacks source evidence');
  }
  const grounded = (value: string) =>
    proposal.facts.some((fact) => fact.value === value);
  for (const value of [
    ...Object.values(proposal.cv.basics),
    ...Object.values(proposal.cv.summary),
    ...proposal.cv.skills.flatMap((skill) => [skill.group, ...skill.items]),
    ...proposal.cv.education.flatMap((education) => Object.values(education)),
  ])
    if (!grounded(value)) throw new Error('CV field lacks source evidence');
  for (const role of proposal.cv.experience) {
    for (const value of [
      role.companyAlias,
      role.title,
      role.start,
      ...(role.end ? [role.end] : []),
    ]) {
      if (!grounded(value))
        throw new Error('Core CV claim lacks source evidence');
    }
    for (const project of role.projects) {
      for (const value of [
        project.alias,
        ...project.stack,
        ...(project.start ? [project.start] : []),
        ...(project.end ? [project.end] : []),
      ]) {
        if (!grounded(value))
          throw new Error('Project claim lacks source evidence');
      }
      for (const bullet of project.bullets) {
        if (!grounded(bullet.text.en) || !grounded(bullet.text.vi))
          throw new Error('Original CV line lacks source evidence');
        if (
          !citation(bullet.factRef) ||
          !Object.values(bullet.text).some((value) =>
            citation(bullet.factRef)!.includes(value),
          )
        )
          throw new Error('CV bullet lacks cited paragraph');
      }
    }
  }
  const seen = new Set<string>();
  const paths = new Set<string>();
  const bullets = new Set<string>();
  const projects = proposal.cv.experience.flatMap((role) =>
    role.projects.map((project) => ({
      id: project.alias,
      technology: project.stack,
      started: Number((project.start ?? role.start).slice(0, 4)),
      ended: Number((project.end ?? role.end ?? role.start).slice(0, 4)),
    })),
  );
  for (const line of proposal.lines) {
    if (seen.has(line.id) || paths.has(line.path))
      throw new Error('Duplicate proposed CV line');
    const bulletPath = line.path.replace(/\.text\.(en|vi)$/u, '');
    if (bullets.has(bulletPath))
      throw new Error('Only one proposal per bullet is supported');
    bullets.add(bulletPath);
    seen.add(line.id);
    paths.add(line.path);
    const [, roleIndex, projectIndex, bulletIndex, locale] =
      /^experience\.(\d+)\.projects\.(\d+)\.bullets\.(\d+)\.text\.(en|vi)$/.exec(
        line.path,
      )!;
    const bullet =
      proposal.cv.experience[Number(roleIndex)]?.projects[Number(projectIndex)]
        ?.bullets[Number(bulletIndex)];
    if (
      !bullet ||
      bullet.text[locale as 'en' | 'vi'] !== line.before ||
      !citation(line.sourceRef)?.includes(line.before) ||
      bullet.factRef !== line.sourceRef ||
      bullet.embellishmentId !== null
    )
      throw new Error('Proposed line differs from original CV');
    if (
      !jd.includes(line.requirementId) ||
      line.decision !== 'pending' ||
      line.defenseScore !== null ||
      line.criticalFindings !== 0
    )
      throw new Error('Proposal cannot pre-approve a line');
    if (
      line.change.kind === 'wording' ||
      line.change.kind === 'projectDetail' ||
      line.change.kind === 'estimate'
    ) {
      if (
        line.change.sourceRef !== line.sourceRef ||
        line.change.requirementId !== line.requirementId
      )
        throw new Error('Proposal source mismatch');
    }
    if (checkPlausibility(line.change, projects, { role: 'owner' }).length)
      throw new Error('Implausible CV proposal');
    if (
      line.embellishment !==
      !paragraphs.some((paragraph) => paragraph.includes(line.after))
    )
      throw new Error('Unsupported detail must be flagged');
  }
}

export function applyOwnerDecision(
  proposal: CvProposal,
  decision: OwnerDecision,
): CvProposal {
  cvProposalSchema.parse(proposal);
  const index = proposal.lines.findIndex((line) => line.id === decision.id);
  if (index < 0 || proposal.lines[index]!.decision !== 'pending')
    throw new Error('Only one pending line may be decided');
  return cvProposalSchema.parse({
    ...proposal,
    lines: proposal.lines.map((line, position) =>
      position === index ? { ...line, decision: decision.decision } : line,
    ),
  });
}

export function assertProposalResolved(proposal: CvProposal): void {
  cvProposalSchema.parse(proposal);
  if (proposal.lines.some((line) => line.decision === 'pending'))
    throw new Error('Pending CV line blocks export');
}

export function approvedCv(proposal: CvProposal): {
  cv: Cv;
  approval: ExportApproval;
} {
  assertProposalResolved(proposal);
  const cv = structuredClone(proposal.cv);
  for (const line of proposal.lines) {
    if (line.decision !== 'approved') continue;
    if (
      line.defenseScore === null ||
      line.defenseScore < 4 ||
      line.criticalFindings
    )
      throw new Error('Approved CV line lacks passing defense');
    const [, roleIndex, projectIndex, bulletIndex, locale] =
      /^experience\.(\d+)\.projects\.(\d+)\.bullets\.(\d+)\.text\.(en|vi)$/.exec(
        line.path,
      )!;
    const bullet =
      cv.experience[Number(roleIndex)]!.projects[Number(projectIndex)]!.bullets[
        Number(bulletIndex)
      ]!;
    bullet.text[locale as 'en' | 'vi'] = line.after;
    bullet.embellishmentId = line.id;
  }
  const approval: ExportApproval = {
    cvVersionId: proposal.cvVersionId,
    approvedVersionId: proposal.cvVersionId,
    embellishments: proposal.lines.map((line) => ({
      id: line.id,
      status: line.decision === 'approved' ? 'approved' : 'rejected',
      lineApproved: line.decision === 'approved',
      defenseEntryId: line.decision === 'approved' ? line.defenseEntryId : null,
      defenseScore: line.decision === 'approved' ? line.defenseScore : null,
      criticalFindings: line.criticalFindings,
    })),
  };
  assertApproved(cv, approval);
  return { cv, approval };
}

export async function renderApprovedDocx(
  proposal: CvProposal,
): Promise<Buffer> {
  const { cv, approval } = approvedCv(proposal);
  return renderDocx(cv, approval);
}

export async function renderApprovedPdf(
  proposal: CvProposal,
  url: string,
): ReturnType<typeof renderPdf> {
  const { cv, approval } = approvedCv(proposal);
  return renderPdf(cv, approval, { gotenbergUrl: url });
}

export async function checkApprovedExport(
  proposal: CvProposal,
  facts: CvFacts,
  rules: OwnerRules,
  extracted: { docx: string; pdf: string },
  module: ModuleV2,
  examination: Examination,
  reviewer: (entryIds: string[]) => Promise<ReadabilityResult>,
): Promise<void> {
  const { cv, approval } = approvedCv(proposal);
  const result = await runGates({
    cv,
    facts,
    approval,
    rules,
    extracted,
    module,
    examination,
    reviewer,
    changes: proposal.lines
      .filter((line) => line.decision === 'approved')
      .map((line) => ({
        id: line.id,
        path: line.path,
        before: line.before,
        after: line.after,
        risk: line.risk,
        reason: line.reason,
        requirementId: line.requirementId,
        change: line.change,
      })),
  });
  if (!result.passed) throw new Error('CV export failed quality gates');
}

export async function exportApprovedCv(
  proposal: CvProposal,
  facts: CvFacts,
  rules: OwnerRules,
  module: ModuleV2,
  examination: Examination,
  reviewer: (entryIds: string[]) => Promise<ReadabilityResult>,
  gotenbergUrl: string,
): Promise<{ docx: Buffer; pdf: Buffer; approval: ExportApproval }> {
  assertProposalResolved(proposal);
  const { approval } = approvedCv(proposal);
  const docx = await renderApprovedDocx(proposal);
  const { pdf } = await renderApprovedPdf(proposal, gotenbergUrl);
  const docxText = (await mammoth.extractRawText({ buffer: docx })).value;
  const pdfText = await extractPdfText(pdf);
  await checkApprovedExport(
    proposal,
    facts,
    rules,
    { docx: docxText, pdf: pdfText },
    module,
    examination,
    reviewer,
  );
  return { docx, pdf, approval };
}

export async function createCvProposal(options: {
  directory?: string;
  source?: 'docx' | 'portfolio';
  portfolioApiUrl?: string;
  portfolioLocale?: 'en' | 'vi';
  portfolioFetch?: typeof fetch;
  repoRoot: string;
  jdPath: string;
  workspace: string;
  cvVersionId: string;
  relay: (
    instructions: string,
    output: string,
    signal: AbortSignal,
  ) => Promise<void>;
  signal: AbortSignal;
}): Promise<CvProposal> {
  const selected = options.source ?? 'docx';
  if (selected !== 'docx' && selected !== 'portfolio')
    throw new PrivateCvError('CV_SOURCE_CONFIG');
  const { paragraphs, pointers } =
    selected === 'portfolio'
      ? await loadPortfolioCv({
          baseUrl: options.portfolioApiUrl,
          locale: options.portfolioLocale,
          fetch: options.portfolioFetch,
          signal: options.signal,
        })
      : {
          ...(await loadPrivateCv(options.directory, options.repoRoot)),
          pointers: undefined,
        };
  const jd = await readFile(options.jdPath, 'utf8');
  if (!jd.trim()) throw new Error('JD is empty');
  const factsFile = resolve(options.workspace, 'cv-source.json');
  const output = resolve(options.workspace, 'cv-proposal-draft.json');
  await writeFile(
    factsFile,
    JSON.stringify(
      paragraphs.map((text, index) => ({
        sourceRef: `cv:paragraph:${index + 1}`,
        text,
        pointer: pointers?.[index] ?? `paragraphs[${index}]`,
      })),
    ),
    { mode: 0o600 },
  );
  const files = {
    jd: options.jdPath,
    cv: factsFile,
    cvFacts: factsFile,
    module: resolve(options.workspace, 'module.json'),
    proposals: output,
    transcript: resolve(options.workspace, 'interview.json'),
    examination: resolve(options.workspace, 'rubric.json'),
    readability: resolve(options.workspace, 'readability.json'),
  };
  if (!canProposeEmbellishments({ role: 'owner' }))
    throw new Error('Owner proposals disabled');
  const instructions = `${generatorPrompt({ files, audience: { role: 'owner' }, revision: 0 })}\nWrite ONLY version 1 JSON to ${JSON.stringify(output)}: state awaiting_owner_approval, cvVersionId ${JSON.stringify(options.cvVersionId)}, baseline CV matching @jdcv/cv-render cvSchema, facts [{kind,value,sourceRef}] and lines [{id,path,before,after,reason,requirementId,sourceRef,risk,riskNote,interviewAnswer,defenseEntryId,change,embellishment,decision:pending,defenseScore:null,criticalFindings:0}]. The JD must contain each requirementId verbatim. Cite exact numbered CV paragraphs and keep every baseline value supported by a cited fact. Never approve or export.`;
  if (Buffer.byteLength(instructions) > 6144)
    throw new Error('Turn exceeds 6144 bytes');
  await options.relay(instructions, output, options.signal);
  const proposal = cvProposalSchema.parse(
    JSON.parse(await readFile(output, 'utf8')),
  );
  if (proposal.cvVersionId !== options.cvVersionId)
    throw new Error('CV version mismatch');
  validateGrounding(proposal, paragraphs, jd);
  return proposal;
}
