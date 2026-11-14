import type { ModuleV2 } from '@jdcv/contracts';

export const MAX_TURN_BYTES = 6144;

export type PrivateFile = string;
export type Audience =
  | { role: 'owner'; embellishmentOptIn?: boolean }
  | {
      role: 'outside';
      embellishmentOptIn: boolean;
      currentTermsAccepted: boolean;
    };

export function canProposeEmbellishments(audience: Audience): boolean {
  return audience.role === 'owner'
    ? audience.embellishmentOptIn !== false
    : audience.embellishmentOptIn && audience.currentTermsAccepted;
}

export interface JobFiles {
  jd: PrivateFile;
  cv: PrivateFile;
  cvFacts: PrivateFile;
  module: PrivateFile;
  proposals: PrivateFile;
  transcript: PrivateFile;
  examination: PrivateFile;
  readability: PrivateFile;
}

export interface TurnOptions {
  files: JobFiles;
  audience: Audience;
  revision: 0 | 1 | 2;
}

function privatePath(path: PrivateFile): string {
  if (
    !path.startsWith('/') ||
    path.includes('..') ||
    /[\r\n\0]/.test(path) ||
    Buffer.byteLength(path, 'utf8') > 512
  ) {
    throw new Error(
      'Expected a private absolute file path of at most 512 bytes',
    );
  }
  return JSON.stringify(path);
}

function bounded(prompt: string): string {
  if (Buffer.byteLength(prompt, 'utf8') > MAX_TURN_BYTES) {
    throw new Error('Turn exceeds 6144 UTF-8 bytes');
  }
  return prompt;
}

export const CLEAR_WRITING_RULES = `Write for someone new to the topic. State the main point and why it matters before the details. Use full sentences and simple words; define every term or acronym on first use. Give each concept a concrete real-world example. Avoid clipped bullets, label walls, keyword stuffing, and filler; use bullets only for parallel ideas. Keep paragraphs short. Give interview answers in a 30-second version first, then a deeper answer. Write Vietnamese naturally, not word for word; keep familiar English technical terms.`;

export function generatorPrompt({
  files,
  audience,
  revision,
}: TurnOptions): string {
  return bounded(`You are the Generator. This is revision ${revision} of at most 2 revisions. Read the JD at ${privatePath(files.jd)}, CV at ${privatePath(files.cv)}, and documented project facts at ${privatePath(files.cvFacts)} in the private job workspace. Read previous module ${privatePath(files.module)} and examination ${privatePath(files.examination)} only for a revision; do not assume they exist on the first turn.
Build or revise the study module and proposed CV line edits. Write a JSON module to ${privatePath(files.module)} matching @jdcv/contracts ModuleV2: version 2, requirements with id and bilingual title, and entries with id, section, jdRequirement, tags, bilingual title, shortAnswer, keyPoints and detail; kbRefs and embellishmentRefs contain identifiers only. Validate version 2 shape and English/Vietnamese parity before handing off. Identify every mandatory JD requirement, even if the module must mark it for revision. Do not place raw CV text in the module's public references.
${CLEAR_WRITING_RULES}
CV embellishment proposals are ${canProposeEmbellishments(audience) ? 'enabled for proposals only' : 'disabled; do not propose any'}. Only suggest defensible wording or plausible detail for an existing CV project, within its documented dates, technology stack, role and team scope. Never invent an employer, project, title, date, years of experience, degree or certification. Never assert unsupported facts; flag uncertainty. An estimated metric needs explicit permission and a documented plausible range. Record each proposed line separately at ${privatePath(files.proposals)} with original and replacement, source/fact reference, requirement ID, reason, risk, review status and linked defence entry ID. Each defence needs a probing question, 30-second answer, deeper technical detail and truthful uncertainty clarification. Do not approve or export any proposal. Report only file paths and non-sensitive status, not JD or CV text.`);
}

export function interviewerPrompt({ files }: TurnOptions): string {
  return bounded(
    `You are the Interviewer in a separate thread. Read the mandatory JD requirements at ${privatePath(files.jd)}, version 2 study module at ${privatePath(files.module)}, and proposed CV edits at ${privatePath(files.proposals)}. Probe every mandatory requirement and every embellishment, including pending edits. Ask one identifiable question per requirement and per edit, plus follow-ups when a claim is vague. Require the candidate to explain actual work, limits and evidence; an answer is not proof of a claim. Record question ID, requirement ID or embellishment ID, candidate answer and follow-up in ${privatePath(files.transcript)}. Never invent candidate answers; if no answer is available, mark it unanswered. Do not include private document bodies in your reply. Report only the output path and non-sensitive status.`,
  );
}

export function examinerPrompt({ files }: TurnOptions): string {
  return bounded(
    `You are the Examiner in a separate thread. Read mandatory JD requirements at ${privatePath(files.jd)}, proposed CV edits at ${privatePath(files.proposals)}, and interview transcript at ${privatePath(files.transcript)}. Score each actual answer from 1 to 5 with a critical flag, question ID, linked requirement IDs and linked embellishment IDs. Missing answers do not count as coverage; do not invent scores. Explain weaknesses and mark unsupported or inconsistent claims critical. Write the structured result to ${privatePath(files.examination)}. The D9 gate requires average >= 4.0/5 over answers, 100% mandatory requirement coverage, every embellishment defence >= 4/5, and zero critical findings. Do not publish when any gate fails; send failures to the Generator for at most two revisions. Return only the output path and non-sensitive status.`,
  );
}

export function readabilityPrompt({ files }: TurnOptions): string {
  return bounded(
    `You are an independent readability reviewer, not the Generator. Read the version 2 module at ${privatePath(files.module)}. Score every study entry from 1 to 5 and write entry IDs, scores, and actionable revision notes to ${privatePath(files.readability)}. Each entry must score at least 4 before publication. ${CLEAR_WRITING_RULES} Flag clipped bullets, long label-value walls, unexplained acronyms and long paragraphs as warnings; your review decides the score. Ask for a rewrite and re-score every entry below 4. Return only the output path and non-sensitive status.`,
  );
}

export type RequirementId = ModuleV2['requirements'][number]['id'];
export type EntryId = ModuleV2['entries'][number]['id'];
export type AnswerScore = 1 | 2 | 3 | 4 | 5;

export interface ExamAnswer {
  questionId: string;
  score: AnswerScore;
  critical: boolean;
  requirementIds: RequirementId[];
  embellishmentIds: string[];
}

export interface Examination {
  answers: ExamAnswer[];
}

export interface GateResult {
  passed: boolean;
  average: number;
  missingRequirements: RequirementId[];
  weakEmbellishments: string[];
  critical: boolean;
}

export function evaluateExamination(
  examination: Examination,
  mandatoryRequirementIds: readonly RequirementId[],
  embellishmentIds: readonly string[],
): GateResult {
  const answers = examination.answers;
  const uniqueQuestions = new Set(answers.map((answer) => answer.questionId));
  const valid =
    answers.length > 0 &&
    uniqueQuestions.size === answers.length &&
    answers.every(
      (answer) =>
        answer.questionId.trim() &&
        Number.isInteger(answer.score) &&
        answer.score >= 1 &&
        answer.score <= 5 &&
        typeof answer.critical === 'boolean',
    );
  const average = valid
    ? answers.reduce((sum, answer) => sum + answer.score, 0) / answers.length
    : 0;
  const missingRequirements = [...new Set(mandatoryRequirementIds)].filter(
    (id) => !answers.some((answer) => answer.requirementIds.includes(id)),
  );
  const weakEmbellishments = [...new Set(embellishmentIds)].filter(
    (id) =>
      !answers.some(
        (answer) => answer.embellishmentIds.includes(id) && answer.score >= 4,
      ) ||
      answers.some(
        (answer) => answer.embellishmentIds.includes(id) && answer.score < 4,
      ),
  );
  const critical = answers.some((answer) => answer.critical);
  return {
    passed:
      valid &&
      average >= 4 &&
      missingRequirements.length === 0 &&
      weakEmbellishments.length === 0 &&
      !critical,
    average,
    missingRequirements,
    weakEmbellishments,
    critical,
  };
}

export interface ReadabilityResult {
  entries: { entryId: EntryId; score: AnswerScore }[];
}

export function evaluateReadability(
  result: ReadabilityResult,
  entryIds: readonly EntryId[],
): boolean {
  return (
    result.entries.length === new Set(entryIds).size &&
    new Set(result.entries.map((entry) => entry.entryId)).size ===
      result.entries.length &&
    result.entries.every(
      (entry) =>
        entryIds.includes(entry.entryId) &&
        Number.isInteger(entry.score) &&
        entry.score >= 4 &&
        entry.score <= 5,
    )
  );
}

export interface ProjectFacts {
  id: string;
  technology: readonly string[];
  started: number;
  ended: number;
}

export type ProposedChange =
  | {
      kind:
        | 'employer'
        | 'title'
        | 'date'
        | 'project'
        | 'credential'
        | 'experienceYears';
    }
  | {
      kind: 'wording' | 'projectDetail' | 'estimate';
      projectId: string;
      requirementId: string;
      sourceRef: string;
      technology?: string;
      technologyAvailableSince?: number;
      estimateAuthorized?: boolean;
      estimateRangeDocumented?: boolean;
      roleAndTeamScopeSupported: boolean;
    };

export function checkPlausibility(
  change: ProposedChange,
  projects: readonly ProjectFacts[],
  audience: Audience,
): string[] {
  const issues: string[] = [];
  if (!canProposeEmbellishments(audience))
    issues.push('Embellishment is disabled');
  if (
    change.kind !== 'wording' &&
    change.kind !== 'projectDetail' &&
    change.kind !== 'estimate'
  ) {
    return [...issues, 'Changing a core CV fact is forbidden'];
  }
  const project = projects.find((item) => item.id === change.projectId);
  if (!project) issues.push('Project does not exist in the CV');
  if (!change.requirementId.trim() || !change.sourceRef.trim())
    issues.push('Requirement and supporting source are required');
  if (!change.roleAndTeamScopeSupported)
    issues.push('Role and team scope lack support');
  if (
    change.technology &&
    (!project?.technology.includes(change.technology) ||
      change.technologyAvailableSince === undefined ||
      change.technologyAvailableSince > project.started)
  )
    issues.push('Technology is outside the known stack or project timeline');
  if (
    change.kind === 'estimate' &&
    (!change.estimateAuthorized || !change.estimateRangeDocumented)
  )
    issues.push('Estimate needs explicit permission and a documented range');
  return issues;
}
