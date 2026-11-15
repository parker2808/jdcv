import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mammoth from 'mammoth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cvLines,
  renderDocx,
  type Cv,
  type ExportApproval,
} from '@jdcv/cv-render';
import type { CvFacts, OwnerRules } from '@jdcv/gates';
import type { ModuleV2 } from '@jdcv/contracts';
import { FileJobQueue } from '@jdcv/queue';
import { MacWorker, type Role } from './index.js';
import {
  applyOwnerDecision,
  approvedCv,
  assertProposalResolved,
  checkApprovedExport,
  createCvProposal,
  loadPrivateCv,
  renderApprovedDocx,
  renderApprovedPdf,
  validateGrounding,
  type CvProposal,
} from './cv-proposal.js';

describe('owner-only CV proposal', () => {
  let root: string;
  let directory: string;
  let cv: Cv;
  let paragraphs: string[];
  let proposal: CvProposal;
  const baseApproval: ExportApproval = {
    cvVersionId: 'sample',
    approvedVersionId: 'sample',
    embellishments: [],
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'jdcv-example-'));
    directory = join(root, 'private-cv');
    await mkdir(directory);
    cv = JSON.parse(
      await readFile(
        new URL('../../cv-render/fixtures/alex-example.json', import.meta.url),
        'utf8',
      ),
    ) as Cv;
    cv.experience[0]!.companyAlias = 'Example Labs';
    await writeFile(
      join(directory, 'general.docx'),
      await renderDocx(cv, baseApproval),
    );
    paragraphs = (await loadPrivateCv(directory, process.cwd())).paragraphs;
    const values = [
      ...Object.values(cv.basics),
      ...Object.values(cv.summary),
      ...cv.experience.flatMap((role) => [
        role.companyAlias,
        role.title,
        role.start,
        ...role.projects.flatMap((project) => [
          project.alias,
          ...project.stack,
          ...project.bullets.flatMap((bullet) => Object.values(bullet.text)),
        ]),
      ]),
      ...cv.skills.flatMap((skill) => [skill.group, ...skill.items]),
      ...cv.education.flatMap((item) => Object.values(item)),
    ];
    const sourceRef = (value: string) => {
      const index = paragraphs.findIndex((paragraph) =>
        paragraph.includes(value),
      );
      if (index < 0) throw new Error('Fixture source line missing');
      return `cv:paragraph:${index + 1}`;
    };
    const before = cv.experience[0]!.projects[0]!.bullets[0]!.text.en;
    cv.experience[0]!.projects[0]!.bullets[0]!.factRef = sourceRef(before);
    proposal = {
      version: 1,
      state: 'awaiting_owner_approval',
      cvVersionId: 'sample',
      cv,
      facts: [...new Set(values)].map((value) => ({
        kind: 'achievement',
        value,
        sourceRef: sourceRef(value),
      })),
      lines: [
        {
          id: 'edit-1',
          path: 'experience.0.projects.0.bullets.0.text.en',
          before,
          after:
            'Improved keyboard navigation and tested it with a keyboard on a sample dashboard.',
          reason: 'The JD requires keyboard accessibility.',
          requirementId: 'req-accessibility',
          sourceRef: sourceRef(before),
          risk: 'medium',
          riskNote: 'Testing detail is not documented in the CV.',
          interviewAnswer:
            'I can explain the navigation work, but must confirm whether I performed that test.',
          defenseEntryId: 'defense-1',
          change: {
            kind: 'projectDetail',
            projectId: 'Project X',
            requirementId: 'req-accessibility',
            sourceRef: sourceRef(before),
            roleAndTeamScopeSupported: true,
          },
          embellishment: true,
          decision: 'pending',
          defenseScore: null,
          criticalFindings: 0,
        },
      ],
    };
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('fails closed on absent, empty, ambiguous, linked and PDF-only sources', async () => {
    await expect(
      loadPrivateCv(join(root, 'absent'), process.cwd()),
    ).rejects.toMatchObject({ code: 'CV_SOURCE_MISSING' });
    await expect(loadPrivateCv(root, process.cwd())).rejects.toMatchObject({
      code: 'CV_SOURCE_MISSING',
    });
    await writeFile(join(directory, 'another.docx'), Buffer.from('example'));
    await expect(loadPrivateCv(directory, process.cwd())).rejects.toMatchObject(
      { code: 'CV_SOURCE_AMBIGUOUS' },
    );
    await rm(join(directory, 'another.docx'));
    await rm(join(directory, 'general.docx'));
    await symlink(join(root, 'missing.docx'), join(directory, 'linked.docx'));
    await expect(loadPrivateCv(directory, process.cwd())).rejects.toMatchObject(
      { code: 'CV_SOURCE_UNSAFE' },
    );
    await rm(join(directory, 'linked.docx'));
    await writeFile(join(directory, 'general.pdf'), Buffer.from('%PDF-1.4'));
    await expect(loadPrivateCv(directory, process.cwd())).rejects.toMatchObject(
      { code: 'CV_SOURCE_UNSUPPORTED' },
    );
  });

  it('rejects invented facts, fabricated original lines and pre-approval', () => {
    validateGrounding(proposal, paragraphs, 'req-accessibility');
    expect(() =>
      validateGrounding(
        {
          ...proposal,
          facts: [
            ...proposal.facts,
            {
              kind: 'skill',
              value: 'Invented skill',
              sourceRef: 'cv:paragraph:1',
            },
          ],
        },
        paragraphs,
        'req-accessibility',
      ),
    ).toThrow('source evidence');
    expect(() =>
      validateGrounding(
        {
          ...proposal,
          lines: [{ ...proposal.lines[0]!, before: 'Invented work' }],
        },
        paragraphs,
        'req-accessibility',
      ),
    ).toThrow('original CV');
    expect(() =>
      validateGrounding(
        {
          ...proposal,
          lines: [{ ...proposal.lines[0]!, decision: 'approved' }],
        },
        paragraphs,
        'req-accessibility',
      ),
    ).toThrow('pre-approve');
  });

  it('uses the injected relay and returns a pending private proposal', async () => {
    const jdPath = join(root, 'jd.txt');
    await writeFile(jdPath, 'req-accessibility: keyboard navigation');
    const result = await createCvProposal({
      directory,
      repoRoot: process.cwd(),
      jdPath,
      workspace: root,
      cvVersionId: 'sample',
      signal: new AbortController().signal,
      relay: async (instructions, output) => {
        expect(instructions).toContain('Generator');
        await writeFile(output, JSON.stringify(proposal));
      },
    });
    expect(result.state).toBe('awaiting_owner_approval');
    expect(result.lines[0]!.decision).toBe('pending');
  });

  it('worker completes with a private proposal pointer, never an approved CV', async () => {
    const jdPath = join(root, 'jd.txt');
    await writeFile(jdPath, 'req-accessibility: keyboard navigation');
    const queue = new FileJobQueue({ directory: join(root, 'queue') });
    const job = await queue.enqueue({
      ownerId: 'owner',
      route: 'mac',
      type: 'generate',
      maxAttempts: 1,
      payload: { inputRef: jdPath },
    });
    let generatorCount = 0;
    const worker = new MacWorker({
      queue,
      ownerId: 'owner',
      privateCvDirectory: directory,
      repoRoot: process.cwd(),
      workspaceRoot: join(root, 'jobs'),
      load: { read: async () => 4 },
      prompts: {
        build: (role: Role, _revision, paths) =>
          JSON.stringify({ role, paths }),
      },
      runner: {
        start: async (role) => ({
          id: role === 'Generator' ? `Generator-${++generatorCount}` : role,
          provider: 'stub',
          model: 'fixture',
        }),
        show: async (thread) => thread,
        send: async (thread, instructions) => {
          if (thread.id === 'Generator-1') {
            const output = /Write ONLY version 1 JSON to "([^"]+)"/.exec(
              instructions,
            )?.[1];
            if (!output) throw new Error('Missing proposal output');
            await writeFile(
              output,
              JSON.stringify({ ...proposal, cvVersionId: job.id }),
            );
            return;
          }
          const { paths } = JSON.parse(instructions) as {
            paths: { module: string; interview: string; rubric: string };
          };
          if (thread.id === 'Generator-2')
            await writeFile(
              paths.module,
              JSON.stringify({
                version: 2,
                requirements: [
                  {
                    id: 'req-accessibility',
                    title: { en: 'Keyboard', vi: 'Bàn phím' },
                  },
                ],
                entries: [
                  {
                    id: 'entry',
                    section: 'interview',
                    jdRequirement: 'req-accessibility',
                    tags: [],
                    title: { en: 'How?', vi: 'Thế nào?' },
                    shortAnswer: {
                      en: 'Test navigation.',
                      vi: 'Thử điều hướng.',
                    },
                    keyPoints: [],
                    detail: { en: 'Use a keyboard.', vi: 'Dùng bàn phím.' },
                  },
                ],
              }),
            );
          if (thread.id === 'Interviewer')
            await writeFile(
              paths.interview,
              JSON.stringify({ covered: ['req-accessibility'], defended: [] }),
            );
          if (thread.id === 'Examiner')
            await writeFile(
              paths.rubric,
              JSON.stringify({
                average: 4,
                mandatoryCoverage: 1,
                embellishmentDefenses: [],
                criticalFindings: 0,
                readability: { entry: 4 },
              }),
            );
        },
      },
    });
    const result = await worker.runOnce();
    expect(result?.status).toBe('completed');
    expect(generatorCount).toBe(2);
    expect(
      JSON.parse(await readFile(result!.outputRef!, 'utf8')),
    ).toMatchObject({
      state: 'awaiting_owner_approval',
      cvVersionId: job.id,
      lines: [{ decision: 'pending' }],
    });
  });

  it('blocks pending export; rejection restores the source; approval retains its record', async () => {
    expect(() => assertProposalResolved(proposal)).toThrow('Pending');
    await expect(renderApprovedDocx(proposal)).rejects.toThrow('Pending');
    await expect(
      renderApprovedPdf(proposal, 'http://localhost:3000'),
    ).rejects.toThrow('Pending');
    const rejected = applyOwnerDecision(proposal, {
      id: 'edit-1',
      decision: 'rejected',
    });
    const original = approvedCv(rejected);
    expect(original.cv.experience[0]!.projects[0]!.bullets[0]!.text.en).toBe(
      proposal.lines[0]!.before,
    );
    expect(original.approval.embellishments[0]!.status).toBe('rejected');
    const rejectedText = (
      await mammoth.extractRawText({
        buffer: await renderApprovedDocx(rejected),
      })
    ).value;
    expect(rejectedText).not.toContain(proposal.lines[0]!.after);
    const decided = applyOwnerDecision(proposal, {
      id: 'edit-1',
      decision: 'approved',
    });
    const defended = {
      ...decided,
      lines: [{ ...decided.lines[0]!, defenseScore: 4 }],
    };
    expect(approvedCv(defended).approval.embellishments[0]).toMatchObject({
      status: 'approved',
      lineApproved: true,
      defenseScore: 4,
    });
    const approvedText = (
      await mammoth.extractRawText({
        buffer: await renderApprovedDocx(defended),
      })
    ).value;
    expect(approvedText).toContain(proposal.lines[0]!.after);
    expect(() =>
      applyOwnerDecision(defended, { id: 'edit-1', decision: 'rejected' }),
    ).toThrow('pending');
  });

  it('runs shared quality gates with an approved line and independent defense', async () => {
    const decided = applyOwnerDecision(proposal, {
      id: 'edit-1',
      decision: 'approved',
    });
    const defended = {
      ...decided,
      lines: [{ ...decided.lines[0]!, defenseScore: 4 }],
    };
    const { cv: rendered } = approvedCv(defended);
    const role = rendered.experience[0]!;
    const facts: CvFacts = {
      companies: [
        {
          alias: role.companyAlias,
          title: role.title,
          start: role.start,
          end: role.end,
          projects: role.projects.map((project) => ({
            alias: project.alias,
            start: project.start,
            end: project.end,
            stack: project.stack,
          })),
        },
      ],
      credentials: rendered.education,
      projects: [
        {
          id: 'Project X',
          technology: ['TypeScript', 'Vue'],
          started: 2023,
          ended: 2023,
        },
      ],
    };
    const rules: OwnerRules = {
      projectAliases: ['Project X'],
      companyAliases: ['Example Labs'],
      formerEmployerAliases: [],
      forbiddenTerms: [],
      unconfirmedClaims: [],
      requireVueParity: false,
    };
    const module: ModuleV2 = {
      version: 2,
      requirements: [
        { id: 'req-accessibility', title: { en: 'Keyboard', vi: 'Bàn phím' } },
      ],
      entries: [
        {
          id: 'defense-1',
          section: 'interview',
          jdRequirement: 'req-accessibility',
          tags: [],
          title: { en: 'How?', vi: 'Thế nào?' },
          shortAnswer: { en: 'Explain the work.', vi: 'Giải thích công việc.' },
          keyPoints: [],
          detail: {
            en: 'Explain uncertainty.',
            vi: 'Giải thích điểm chưa chắc.',
          },
          embellishmentRefs: [
            { id: 'edit-1', status: 'approved', defenseEntryId: 'defense-1' },
          ],
        },
      ],
    };
    const text = cvLines(rendered).join('\n');
    await expect(
      checkApprovedExport(
        defended,
        facts,
        rules,
        { docx: text, pdf: text },
        module,
        {
          answers: [
            {
              questionId: 'question-1',
              score: 4,
              critical: false,
              requirementIds: ['req-accessibility'],
              embellishmentIds: ['edit-1'],
            },
          ],
        },
        async () => ({ entries: [{ entryId: 'defense-1', score: 4 }] }),
      ),
    ).resolves.toBeUndefined();
  });
});
