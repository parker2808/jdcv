import {
  checkModuleLanguageParity,
  moduleV2Schema,
  type QualityGateResult,
} from '@jdcv/contracts';
import {
  assertExtractedText,
  cvLines,
  cvSchema,
  type Cv,
  type ExportApproval,
} from '@jdcv/cv-render';
import {
  checkPlausibility,
  evaluateExamination,
  evaluateReadability,
  type Audience,
  type Examination,
  type ProjectFacts,
  type ProposedChange,
  type ReadabilityResult,
} from '@jdcv/prompts';

export interface CvFacts {
  companies: {
    alias: string;
    title: string;
    start: string;
    end: string | null;
    projects: {
      alias: string;
      start?: string;
      end?: string | null;
      stack: string[];
    }[];
  }[];
  credentials: { institution: string; qualification: string; year: string }[];
  projects: ProjectFacts[];
}
export interface OwnerRules {
  projectAliases: string[];
  companyAliases: string[];
  formerEmployerAliases: string[];
  forbiddenTerms: string[];
  unconfirmedClaims: string[];
  requireVueParity: boolean;
}
export interface GateInput {
  cv?: unknown;
  facts?: CvFacts;
  approval?: ExportApproval;
  changes?: {
    id: string;
    path: string;
    before: string;
    after: string;
    risk: 'low' | 'medium' | 'high';
    reason: string;
    requirementId: string;
    change: ProposedChange;
  }[];
  audience?: Audience;
  module?: unknown;
  publicText?: string;
  rules?: OwnerRules;
  examination?: Examination;
  extracted?: { docx: string; pdf: string };
  reviewer?: (entryIds: string[]) => Promise<ReadabilityResult>;
}

export async function runGates(input: GateInput): Promise<QualityGateResult> {
  const failures: QualityGateResult['failures'] = [];
  const fail = (field: string, reason: string) =>
    failures.push({ field, reason });
  const parsedCv = input.cv === undefined ? null : cvSchema.safeParse(input.cv);
  const cv: Cv | undefined = parsedCv?.success ? parsedCv.data : undefined;
  if (parsedCv && !parsedCv.success)
    for (const issue of parsedCv.error.issues)
      fail(`cv.${issue.path.join('.')}`, issue.message);
  if (cv) {
    if (!input.facts) fail('facts', 'CV facts are required');
    else {
      if (cv.experience.length !== input.facts.companies.length)
        fail('cv.experience', 'Company facts differ');
      cv.experience.forEach((role, index) => {
        const fact = input.facts!.companies[index];
        if (
          !fact ||
          [role.companyAlias, role.title, role.start, role.end].some(
            (value, position) =>
              value !==
              [fact.alias, fact.title, fact.start, fact.end][position],
          )
        )
          fail(
            `cv.experience.${index}`,
            'Company, title or dates differ from CV facts',
          );
        role.projects.forEach((project, projectIndex) => {
          const source = fact?.projects[projectIndex];
          if (
            !source ||
            project.alias !== source.alias ||
            project.start !== source.start ||
            project.end !== source.end ||
            JSON.stringify(project.stack) !== JSON.stringify(source.stack)
          )
            fail(
              `cv.experience.${index}.projects.${projectIndex}`,
              'Project, dates or stack differ from CV facts',
            );
        });
        if (role.projects.length !== fact?.projects.length)
          fail(
            `cv.experience.${index}.projects`,
            'Project count differs from CV facts',
          );
      });
      if (
        JSON.stringify(cv.education) !== JSON.stringify(input.facts.credentials)
      )
        fail('cv.education', 'Credentials differ from CV facts');
    }
    if (
      !input.approval ||
      input.approval.cvVersionId !== input.approval.approvedVersionId
    )
      fail('approval.cvVersionId', 'CV version is not approved');
    const decisions = input.approval?.embellishments ?? [];
    const ids = new Set(decisions.map((item) => item.id));
    if (ids.size !== decisions.length)
      fail('approval.embellishments', 'Duplicate approval decision');
    const defenseIds = new Set<string>();
    for (const [index, change] of (input.changes ?? []).entries()) {
      const field = `changes.${index}`;
      if (
        !change.path ||
        !change.before ||
        !change.after ||
        !change.reason ||
        !change.requirementId ||
        !change.risk
      )
        fail(field, 'A line diff, reason, risk and requirement are required');
      for (const reason of checkPlausibility(
        change.change,
        input.facts?.projects ?? [],
        input.audience ?? { role: 'owner' },
      ))
        fail(`${field}.change`, reason);
      const decision = decisions.find((item) => item.id === change.id);
      if (
        !decision ||
        decision.status !== 'approved' ||
        !decision.lineApproved ||
        !decision.defenseEntryId ||
        decision.defenseScore === null ||
        decision.defenseScore < 4 ||
        decision.criticalFindings !== 0
      )
        fail(
          `${field}.approval`,
          'Line approval and passing defense are required',
        );
      if (decision?.defenseEntryId) {
        if (defenseIds.has(decision.defenseEntryId))
          fail(`${field}.defenseEntryId`, 'Defense entry must be unique');
        defenseIds.add(decision.defenseEntryId);
      }
      const referencedLines = cv.experience.flatMap((role) =>
        role.projects.flatMap((project) =>
          project.bullets.filter(
            (bullet) => bullet.embellishmentId === change.id,
          ),
        ),
      );
      if (referencedLines.length !== 1)
        fail(`${field}.id`, 'Change must reference exactly one CV line');
      if (
        referencedLines.length === 1 &&
        !Object.values(referencedLines[0]!.text).includes(change.after)
      )
        fail(
          `${field}.after`,
          'Approved wording must match the exported CV line',
        );
    }
    for (const [index, role] of cv.experience.entries())
      for (const [projectIndex, project] of role.projects.entries())
        for (const [bulletIndex, bullet] of project.bullets.entries()) {
          const field = `cv.experience.${index}.projects.${projectIndex}.bullets.${bulletIndex}`;
          if (
            bullet.embellishmentId &&
            !input.changes?.some(
              (change) => change.id === bullet.embellishmentId,
            )
          )
            fail(field, 'Every changed line needs a proposal');
          if (
            input.rules?.unconfirmedClaims.some((claim) =>
              Object.values(bullet.text).some((text) =>
                text.toLowerCase().includes(claim.toLowerCase()),
              ),
            ) &&
            !bullet.embellishmentId
          )
            fail(field, 'Unconfirmed claim needs embellishment approval');
        }
    if (input.rules) {
      const rules = input.rules;
      cv.experience.forEach((role, index) => {
        if (!rules.companyAliases.includes(role.companyAlias))
          fail(
            `cv.experience.${index}.companyAlias`,
            'Use an approved company alias',
          );
        if (
          rules.formerEmployerAliases.includes(role.companyAlias) &&
          (!role.confidential || role.companyAlias !== 'Confidential')
        )
          fail(
            `cv.experience.${index}.companyAlias`,
            'Former employer must be Confidential',
          );
        role.projects.forEach((project, projectIndex) => {
          if (!rules.projectAliases.includes(project.alias))
            fail(
              `cv.experience.${index}.projects.${projectIndex}.alias`,
              'Use an approved project alias',
            );
        });
        if (index && cv.experience[index - 1]!.start < role.start)
          fail(
            `cv.experience.${index}.start`,
            'Experience must be newest first',
          );
      });
      if (rules.requireVueParity) {
        const skills = cv.skills.flatMap((group) =>
          group.items.map((item) => item.toLowerCase()),
        );
        if (skills.includes('react') && !skills.includes('vue'))
          fail('cv.skills', 'Vue must be weighted like React');
      }
    }
    if (!input.extracted)
      fail('extracted', 'Both DOCX and PDF text extraction are required');
    else
      for (const format of ['docx', 'pdf'] as const) {
        try {
          assertExtractedText(input.extracted[format], cv);
        } catch {
          fail(
            `extracted.${format}`,
            'Reading order or Vietnamese diacritics differ from approved CV',
          );
        }
      }
  }
  const module =
    input.module === undefined ? null : moduleV2Schema.safeParse(input.module);
  if (module && !module.success)
    for (const issue of module.error.issues)
      fail(`module.${issue.path.join('.')}`, issue.message);
  for (const issue of checkModuleLanguageParity(input.module))
    fail(
      `module.${issue.path}`,
      'English and Vietnamese text are both required',
    );
  if (module?.success) {
    if (!input.reviewer)
      fail('reviewer', 'Independent readability review is required');
    else {
      const entries = module.data.entries.map((entry) => entry.id);
      try {
        if (!evaluateReadability(await input.reviewer(entries), entries))
          fail('module.entries', 'Every entry needs readability at least 4/5');
      } catch {
        fail('reviewer', 'Readability review failed');
      }
    }
    const embellishments = (input.changes ?? []).map((change) => change.id);
    if (embellishments.length) {
      if (
        !input.examination ||
        !evaluateExamination(
          input.examination,
          module.data.requirements.map((item) => item.id),
          embellishments,
        ).passed
      )
        fail(
          'examination',
          'Defense interview must cover every claim at 4/5 without critical findings',
        );
      for (const change of input.changes ?? [])
        if (
          module.data.entries
            .flatMap((entry) => entry.embellishmentRefs ?? [])
            .filter(
              (ref) =>
                ref.id === change.id &&
                ref.status === 'approved' &&
                ref.defenseEntryId ===
                  input.approval?.embellishments.find(
                    (decision) => decision.id === change.id,
                  )?.defenseEntryId,
            ).length !== 1
        )
          fail(
            `module.embellishmentRefs.${change.id}`,
            'Exactly one approved defense entry is required',
          );
    }
  }
  const text = [
    input.publicText ?? '',
    ...(cv ? cvLines(cv).filter((line) => line !== cv.basics.contact) : []),
    ...(module?.success
      ? module.data.entries.flatMap((entry) => [
          entry.title.en,
          entry.title.vi,
          entry.shortAnswer.en,
          entry.shortAnswer.vi,
          entry.detail.en,
          entry.detail.vi,
        ])
      : []),
  ].join('\n');
  if (/\u2014/u.test(text)) fail('publicText', 'Em dash is not allowed');
  if (input.rules && /\b(?:AI|artificial intelligence)\b/iu.test(text))
    fail('publicText', 'Owner CV policy forbids AI mentions');
  if (
    /\b(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\d .()-]{8,}\d)|(?:sk-[A-Za-z0-9_-]{16,}|gh[opusr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}))\b/iu.test(
      text,
    )
  )
    fail('publicText', 'Personal data or secret pattern detected');
  if (/https?:\/\/|www\./iu.test(text))
    fail('publicText', 'Links are not allowed');
  if (
    input.rules?.forbiddenTerms.some(
      (term) => term && text.toLowerCase().includes(term.toLowerCase()),
    )
  )
    fail('publicText', 'Forbidden public term detected');
  return { passed: failures.length === 0, failures };
}
