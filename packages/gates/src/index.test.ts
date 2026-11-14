import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cvLines, type Cv } from '@jdcv/cv-render';
import { runGates, type GateInput } from './index.js';

const sample = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../cv-render/fixtures/alex-example.json', import.meta.url),
    ),
    'utf8',
  ),
) as Cv;
const moduleSample = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../contracts/src/fixtures/fde-v2.json', import.meta.url),
    ),
    'utf8',
  ),
);
function fixture(): GateInput {
  const cv = structuredClone(sample);
  const module = structuredClone(moduleSample);
  return {
    cv,
    module,
    facts: {
      companies: cv.experience.map((role) => ({
        alias: role.companyAlias,
        title: role.title,
        start: role.start,
        end: role.end,
        projects: role.projects.map((project) => ({
          alias: project.alias,
          start: project.start,
          end: project.end,
          stack: [...project.stack],
        })),
      })),
      credentials: structuredClone(cv.education),
      projects: [
        {
          id: 'project-x',
          technology: ['Vue', 'TypeScript'],
          started: 2023,
          ended: 2025,
        },
      ],
    },
    approval: {
      cvVersionId: 'v1',
      approvedVersionId: 'v1',
      embellishments: [],
    },
    changes: [],
    audience: { role: 'owner' },
    rules: {
      projectAliases: ['Project X'],
      companyAliases: ['Company A'],
      formerEmployerAliases: [],
      forbiddenTerms: ['internal-repository'],
      unconfirmedClaims: ['Zustand', '43 routes', 'e2e', 'Docker'],
      requireVueParity: true,
    },
    extracted: { docx: cvLines(cv).join(' '), pdf: cvLines(cv).join(' ') },
    reviewer: async (ids) => ({
      entries: ids.map((entryId) => ({ entryId, score: 4 as const })),
    }),
  };
}

function changedLine(input: GateInput): void {
  const cv = input.cv as Cv;
  cv.experience[0]!.projects[0]!.bullets[0]!.embellishmentId = 'change-1';
  input.changes = [
    {
      id: 'change-1',
      path: 'experience.0.projects.0.bullets.0',
      before: 'Original wording',
      after: cv.experience[0]!.projects[0]!.bullets[0]!.text.en,
      reason: 'Fulfills a role requirement',
      risk: 'low',
      requirementId: 'req-frontend',
      change: {
        kind: 'wording',
        projectId: 'project-x',
        requirementId: 'req-frontend',
        sourceRef: 'fact-1',
        roleAndTeamScopeSupported: true,
      },
    },
  ];
  input.approval!.embellishments.push({
    id: 'change-1',
    status: 'approved',
    lineApproved: true,
    defenseEntryId: 'q-frontend',
    defenseScore: 4,
    criticalFindings: 0,
  });
  input.module.entries[0].embellishmentRefs = [
    { id: 'change-1', status: 'approved', defenseEntryId: 'q-frontend' },
  ];
  input.examination = {
    answers: [
      {
        questionId: 'question-1',
        score: 4,
        critical: false,
        requirementIds: ['req-frontend'],
        embellishmentIds: ['change-1'],
      },
    ],
  };
}

describe('quality gates', () => {
  it('accepts an unchanged, fully reviewed fictional CV', async () => {
    expect(await runGates(fixture())).toEqual({ passed: true, failures: [] });
  });
  it.each([
    [
      'company fact',
      (input: GateInput) => {
        (input.cv as Cv).experience[0]!.title = 'Invented title';
      },
    ],
    [
      'credential',
      (input: GateInput) => {
        (input.cv as Cv).education[0]!.year = '2024';
      },
    ],
    [
      'project',
      (input: GateInput) => {
        (input.cv as Cv).experience[0]!.projects[0]!.alias = 'Other project';
      },
    ],
    [
      'unconfirmed claim',
      (input: GateInput) => {
        (input.cv as Cv).experience[0]!.projects[0]!.bullets[0]!.text.en +=
          ' Zustand';
      },
    ],
    [
      'missing line approval',
      (input: GateInput) => {
        changedLine(input);
        input.approval!.embellishments[0]!.lineApproved = false;
      },
    ],
    [
      'missing defence',
      (input: GateInput) => {
        changedLine(input);
        input.approval!.embellishments[0]!.defenseEntryId = null;
      },
    ],
    [
      'weak interview',
      (input: GateInput) => {
        changedLine(input);
        input.examination!.answers[0]!.score = 3;
      },
    ],
    [
      'future technology',
      (input: GateInput) => {
        changedLine(input);
        Object.assign(input.changes![0]!.change, {
          technology: 'Vue',
          technologyAvailableSince: 2024,
        });
      },
    ],
    [
      'unknown technology',
      (input: GateInput) => {
        changedLine(input);
        Object.assign(input.changes![0]!.change, {
          technology: 'Unknown',
          technologyAvailableSince: 2020,
        });
      },
    ],
    [
      'em dash',
      (input: GateInput) => {
        input.publicText = 'A — B';
      },
    ],
    [
      'normal link',
      (input: GateInput) => {
        input.publicText = 'https://example.test';
      },
    ],
    [
      'private name',
      (input: GateInput) => {
        input.publicText = 'internal-repository';
      },
    ],
    [
      'AI mention',
      (input: GateInput) => {
        input.publicText = 'AI-assisted writing';
      },
    ],
    [
      'approved wording differs from exported line',
      (input: GateInput) => {
        changedLine(input);
        input.changes![0]!.after = 'Different approved text';
      },
    ],
    [
      'personal email',
      (input: GateInput) => {
        input.publicText = 'sample@example.test';
      },
    ],
    [
      'secret pattern',
      (input: GateInput) => {
        input.publicText = `sk-${'A'.repeat(24)}`;
      },
    ],
    [
      'missing translation',
      (input: GateInput) => {
        input.module.entries[0].title.vi = '';
      },
    ],
    [
      'reading order',
      (input: GateInput) => {
        input.extracted!.pdf = 'Wrong text';
      },
    ],
    [
      'readability',
      (input: GateInput) => {
        input.reviewer = async (ids) => ({
          entries: ids.map((entryId) => ({ entryId, score: 3 })),
        });
      },
    ],
    [
      'alias policy',
      (input: GateInput) => {
        input.rules!.companyAliases = [];
      },
    ],
    [
      'date order',
      (input: GateInput) => {
        const role = structuredClone((input.cv as Cv).experience[0]!);
        role.start = '2020-01';
        (input.cv as Cv).experience.push(role);
        input.facts!.companies.push({
          ...input.facts!.companies[0]!,
          start: role.start,
        });
      },
    ],
    [
      'Vue parity',
      (input: GateInput) => {
        (input.cv as Cv).skills[0]!.items.push('React');
      },
    ],
  ] as const)(
    'blocks %s and allows the corresponding clean case',
    async (_, change) => {
      const input = fixture();
      change(input);
      if ((input.cv as Cv).experience.length === 1 && _ !== 'reading order')
        input.extracted = {
          docx: cvLines(input.cv as Cv).join(' '),
          pdf: cvLines(input.cv as Cv).join(' '),
        };
      const result = await runGates(input);
      expect(result.passed).toBe(false);
      expect(
        result.failures.every((failure) => failure.field && failure.reason),
      ).toBe(true);
      expect((await runGates(fixture())).passed).toBe(true);
    },
  );
  it('accepts an approved, defended line with technology available before the project', async () => {
    const input = fixture();
    changedLine(input);
    Object.assign(input.changes![0]!.change, {
      technology: 'Vue',
      technologyAvailableSince: 2020,
    });
    expect((await runGates(input)).failures).toEqual([]);
  });
});
