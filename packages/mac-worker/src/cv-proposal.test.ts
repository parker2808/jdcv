import {
  mkdtemp,
  mkdir,
  lstat,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
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
  readDeliveryManifest,
  writeDeliveryManifest,
} from './delivery-manifest.js';
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
  const deliver = async (selected: CvProposal = proposal) =>
    writeDeliveryManifest({
      resultDir: join(root, 'result'),
      jobId: 'example-job',
      ownerId: 'example-owner',
      proposal: selected,
      exported: {
        docx: Buffer.from('fictional approved Word bytes'),
        pdf: Buffer.from('fictional approved PDF bytes'),
        approval: approvedCv(selected).approval,
      },
    });

  it('publishes documents before a private, complete manifest', async () => {
    const selected = applyOwnerDecision(proposal, {
      id: 'edit-1',
      decision: 'rejected',
    });
    const manifest = await deliver(selected);
    expect((await readDeliveryManifest(join(root, 'result'))).diff).toEqual(
      manifest.diff,
    );
    expect(manifest.diff[0]?.decision).toBe('rejected');
    for (const name of [
      'approved.docx',
      'approved.pdf',
      'delivery-manifest.json',
    ])
      expect((await lstat(join(root, 'result', name))).mode & 0o777).toBe(
        0o600,
      );
    expect((await lstat(join(root, 'result'))).mode & 0o777).toBe(0o700);
  });

  it('keeps an approved fictional edit and its defence in the handoff', async () => {
    const decided = applyOwnerDecision(proposal, {
      id: 'edit-1',
      decision: 'approved',
    });
    const defended = {
      ...decided,
      lines: [{ ...decided.lines[0]!, defenseScore: 4 }],
    };
    const result = await deliver(defended);
    expect(result.diff[0]?.decision).toBe('approved');
    expect(result.approval.embellishments[0]?.defenseScore).toBe(4);
    await expect(readDeliveryManifest(join(root, 'result'))).resolves.toEqual(
      result,
    );
  });

  it('holds pending proposals and mismatched export approvals without a manifest', async () => {
    await expect(deliver()).rejects.toThrow();
    const selected = applyOwnerDecision(proposal, {
      id: 'edit-1',
      decision: 'rejected',
    });
    await expect(
      writeDeliveryManifest({
        resultDir: join(root, 'result'),
        jobId: 'example-job',
        ownerId: 'example-owner',
        proposal: selected,
        exported: {
          docx: Buffer.from('docx'),
          pdf: Buffer.from('pdf'),
          approval: baseApproval,
        },
      }),
    ).rejects.toThrow();
    await expect(
      lstat(join(root, 'result', 'delivery-manifest.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses tampered bytes, missing files and altered hashes', async () => {
    await deliver(
      applyOwnerDecision(proposal, { id: 'edit-1', decision: 'rejected' }),
    );
    const resultDir = join(root, 'result');
    const docx = join(resultDir, 'approved.docx');
    const original = await readFile(docx);
    await writeFile(docx, Buffer.from('tampered'));
    await expect(readDeliveryManifest(resultDir)).rejects.toThrow();
    await writeFile(docx, original);
    const manifestPath = join(resultDir, 'delivery-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.docx.sha256 = createHash('sha256').update('other').digest('hex');
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(readDeliveryManifest(resultDir)).rejects.toThrow();
    manifest.docx.sha256 = createHash('sha256').update(original).digest('hex');
    await writeFile(manifestPath, JSON.stringify(manifest));
    await rm(docx);
    await expect(readDeliveryManifest(resultDir)).rejects.toThrow();
  });

  it('rejects path escapes, absolute names, links and incomplete decisions', async () => {
    await deliver(
      applyOwnerDecision(proposal, { id: 'edit-1', decision: 'rejected' }),
    );
    const resultDir = join(root, 'result');
    const manifestPath = join(resultDir, 'delivery-manifest.json');
    const original = JSON.parse(await readFile(manifestPath, 'utf8'));
    for (const name of [
      '../outside.docx',
      join(root, 'outside.docx'),
      'sub/approved.docx',
    ]) {
      await writeFile(
        manifestPath,
        JSON.stringify({
          ...original,
          docx: { ...original.docx, fileName: name },
        }),
      );
      await expect(readDeliveryManifest(resultDir)).rejects.toThrow();
    }
    await writeFile(
      manifestPath,
      JSON.stringify({
        ...original,
        diff: [{ ...original.diff[0], decision: 'pending' }],
      }),
    );
    await expect(readDeliveryManifest(resultDir)).rejects.toThrow();
    await writeFile(manifestPath, JSON.stringify(original));
    await rm(join(resultDir, 'approved.docx'));
    await symlink(
      join(directory, 'general.docx'),
      join(resultDir, 'approved.docx'),
    );
    await expect(readDeliveryManifest(resultDir)).rejects.toThrow();
  });

  it('does not expose a manifest after a partial write', async () => {
    const resultDir = join(root, 'result');
    await mkdir(resultDir, { mode: 0o700 });
    await writeFile(join(resultDir, 'approved.docx'), 'partial', {
      mode: 0o600,
    });
    await writeFile(join(resultDir, '.interrupted.tmp'), '{}', { mode: 0o600 });
    await expect(readDeliveryManifest(resultDir)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      lstat(join(resultDir, 'delivery-manifest.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a linked result directory and an existing output file', async () => {
    const selected = applyOwnerDecision(proposal, {
      id: 'edit-1',
      decision: 'rejected',
    });
    await symlink(directory, join(root, 'linked-result'));
    await expect(
      writeDeliveryManifest({
        resultDir: join(root, 'linked-result'),
        jobId: 'example-job',
        ownerId: 'example-owner',
        proposal: selected,
        exported: {
          docx: Buffer.from('docx'),
          pdf: Buffer.from('pdf'),
          approval: approvedCv(selected).approval,
        },
      }),
    ).rejects.toThrow();
    const resultDir = join(root, 'result');
    await mkdir(resultDir, { mode: 0o700 });
    await writeFile(join(resultDir, 'approved.docx'), 'existing', {
      mode: 0o600,
    });
    await expect(deliver(selected)).rejects.toThrow();
    await expect(
      lstat(join(resultDir, 'delivery-manifest.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
