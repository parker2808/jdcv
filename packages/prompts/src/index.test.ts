import { describe, expect, it } from 'vitest';
import {
  canProposeEmbellishments,
  checkPlausibility,
  CLEAR_WRITING_RULES,
  evaluateExamination,
  evaluateReadability,
  examinerPrompt,
  generatorPrompt,
  interviewerPrompt,
  MAX_TURN_BYTES,
  readabilityPrompt,
  type Audience,
  type Examination,
  type JobFiles,
  type ProposedChange,
} from './index.js';

const owner: Audience = { role: 'owner' };
const outside: Audience = {
  role: 'outside',
  embellishmentOptIn: false,
  currentTermsAccepted: false,
};
const fakePath = (name: string): string =>
  `/private/jobs/alex-example/${'fictional-input/'.repeat(26)}${name}`;
const files: JobFiles = {
  jd: fakePath('jd.txt'),
  cv: fakePath('cv.txt'),
  cvFacts: fakePath('cv-facts.json'),
  module: fakePath('module.json'),
  proposals: fakePath('proposals.json'),
  transcript: fakePath('transcript.json'),
  examination: fakePath('examination.json'),
  readability: fakePath('readability.json'),
};
const turn = { files, audience: owner, revision: 2 as const };

describe('rendered turns', () => {
  it.each([
    ['Generator', generatorPrompt],
    ['Interviewer', interviewerPrompt],
    ['Examiner', examinerPrompt],
    ['readability reviewer', readabilityPrompt],
  ])(
    '%s stays within the UTF-8 byte budget with long fictional paths',
    (_, render) => {
      const prompt = render(turn);
      expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(
        MAX_TURN_BYTES,
      );
      expect(prompt).toContain('/private/jobs/alex-example/');
      expect(prompt).not.toContain('Alex Example');
    },
  );

  it('rejects unsafe and oversized file references', () => {
    expect(() =>
      generatorPrompt({ ...turn, files: { ...files, cv: 'CV text\n' } }),
    ).toThrow();
    expect(() =>
      generatorPrompt({
        ...turn,
        files: { ...files, cv: `/private/${'x'.repeat(513)}` },
      }),
    ).toThrow();
  });

  it('puts clear-writing rules in both writing and review prompts', () => {
    for (const prompt of [generatorPrompt(turn), readabilityPrompt(turn)]) {
      expect(prompt).toContain(CLEAR_WRITING_RULES);
      for (const rule of [
        'full sentences',
        'why it matters',
        'real-world example',
        'term or acronym on first use',
        '30-second version first',
        'Vietnamese naturally',
      ])
        expect(prompt).toContain(rule);
    }
  });
});

const passing: Examination = {
  answers: [
    {
      questionId: 'question-1',
      score: 4,
      critical: false,
      requirementIds: ['mandatory-frontend'],
      embellishmentIds: ['edit-1'],
    },
    {
      questionId: 'question-2',
      score: 4,
      critical: false,
      requirementIds: ['mandatory-testing'],
      embellishmentIds: [],
    },
  ],
};
const gate = (result: Examination) =>
  evaluateExamination(
    result,
    ['mandatory-frontend', 'mandatory-testing'],
    ['edit-1'],
  );

describe('D9 examination gate', () => {
  it('passes at the exact average and defence boundary', () => {
    expect(gate(passing)).toMatchObject({ passed: true, average: 4 });
  });

  it('fails if the average falls below four', () => {
    const result = gate({
      answers: [
        ...passing.answers,
        { ...passing.answers[1], questionId: 'question-3', score: 1 },
      ],
    });
    expect(result).toMatchObject({ passed: false, average: 3 });
  });

  it('fails if even one mandatory requirement is missing', () => {
    expect(gate({ answers: [passing.answers[0]] })).toMatchObject({
      passed: false,
      missingRequirements: ['mandatory-testing'],
    });
  });

  it('fails on a weak or missing embellishment defence', () => {
    expect(
      gate({
        answers: [
          { ...passing.answers[0], score: 3 },
          { ...passing.answers[1], score: 5 },
        ],
      }),
    ).toMatchObject({ passed: false, weakEmbellishments: ['edit-1'] });
    expect(
      gate({
        answers: passing.answers.map((answer) => ({
          ...answer,
          embellishmentIds: [],
        })),
      }).passed,
    ).toBe(false);
  });

  it('fails on a critical finding or malformed examination', () => {
    expect(
      gate({
        answers: [
          { ...passing.answers[0], critical: true },
          passing.answers[1],
        ],
      }),
    ).toMatchObject({ passed: false, critical: true });
    expect(
      gate({
        answers: [{ ...passing.answers[0], score: 6 as 5 }, passing.answers[1]],
      }).passed,
    ).toBe(false);
    expect(gate({ answers: [] }).passed).toBe(false);
  });
});

describe('readability gate', () => {
  it('requires a valid score of at least four for each entry', () => {
    const result = {
      entries: [
        { entryId: 'concept-1', score: 4 as const },
        { entryId: 'concept-2', score: 5 as const },
      ],
    };
    expect(evaluateReadability(result, ['concept-1', 'concept-2'])).toBe(true);
    expect(
      evaluateReadability(result, ['concept-1', 'concept-2', 'concept-3']),
    ).toBe(false);
    expect(
      evaluateReadability({ entries: [{ entryId: 'concept-1', score: 3 }] }, [
        'concept-1',
      ]),
    ).toBe(false);
  });
});

describe('CV proposal policy', () => {
  it('defaults on only for the owner, and requires outside opt-in and current terms', () => {
    expect(canProposeEmbellishments(owner)).toBe(true);
    expect(
      canProposeEmbellishments({ role: 'owner', embellishmentOptIn: false }),
    ).toBe(false);
    expect(canProposeEmbellishments(outside)).toBe(false);
    expect(
      canProposeEmbellishments({ ...outside, embellishmentOptIn: true }),
    ).toBe(false);
    expect(
      canProposeEmbellishments({ ...outside, currentTermsAccepted: true }),
    ).toBe(false);
    expect(
      canProposeEmbellishments({
        ...outside,
        embellishmentOptIn: true,
        currentTermsAccepted: true,
      }),
    ).toBe(true);
    expect(generatorPrompt({ ...turn, audience: outside })).toContain(
      'disabled; do not propose any',
    );
  });

  const projects = [
    {
      id: 'fictional-project',
      started: 2020,
      ended: 2022,
      technology: ['TypeScript'],
    },
  ];
  const detail: ProposedChange = {
    kind: 'projectDetail',
    projectId: 'fictional-project',
    requirementId: 'mandatory-frontend',
    sourceRef: 'fact-1',
    roleAndTeamScopeSupported: true,
    technology: 'TypeScript',
    technologyAvailableSince: 2012,
  };

  it('allows a supported existing project detail but never invents core facts', () => {
    expect(checkPlausibility(detail, projects, owner)).toEqual([]);
    for (const kind of [
      'employer',
      'title',
      'date',
      'project',
      'credential',
      'experienceYears',
    ] as const)
      expect(checkPlausibility({ kind }, projects, owner)).toContain(
        'Changing a core CV fact is forbidden',
      );
  });

  it('flags absent projects, unsupported scope or technology, and unapproved estimates', () => {
    expect(checkPlausibility(detail, projects, outside)).toContain(
      'Embellishment is disabled',
    );
    expect(
      checkPlausibility({ ...detail, projectId: 'invented' }, projects, owner),
    ).toContain('Project does not exist in the CV');
    expect(
      checkPlausibility(
        { ...detail, roleAndTeamScopeSupported: false },
        projects,
        owner,
      ),
    ).toContain('Role and team scope lack support');
    expect(
      checkPlausibility(
        { ...detail, technology: 'ImaginaryStack' },
        projects,
        owner,
      ),
    ).toContain('Technology is outside the known stack or project timeline');
    expect(
      checkPlausibility({ ...detail, kind: 'estimate' }, projects, owner),
    ).toContain('Estimate needs explicit permission and a documented range');
  });
});
