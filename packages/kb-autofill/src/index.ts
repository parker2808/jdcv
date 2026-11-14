import { kbRefSchema } from '@jdcv/contracts';
import { runGates } from '@jdcv/gates';

export interface Topic {
  slug: string;
  title: string;
  aliases: string[];
  tags: string[];
  sections: { id: string; heading: string }[];
}
export interface Link {
  moduleId: string;
  kbSlug: string;
  sectionId: string;
  matchType: 'exact' | 'alias' | 'fuzzy' | 'judged' | 'partial' | 'new';
  prUrl: string | null;
  state: 'pending' | 'live' | 'rejected';
}
export interface Proposal {
  topics: { slug: string; content: string }[];
  sections: { slug: string; sectionId: string; content: string }[];
}
export interface ContentClient {
  listTopics(): Promise<Topic[]>;
  pendingTopics(): Promise<
    { slug: string; sectionId: string; prUrl: string }[]
  >;
  prForJob(jobId: string): Promise<string | null>;
  validate(proposal: Proposal): Promise<void>;
  syncIndex(proposal: Proposal): Promise<void>;
  scanSecrets(proposal: Proposal): Promise<void>;
  scanPersonalData(proposal: Proposal): Promise<void>;
  openPr(branch: string, proposal: Proposal): Promise<string>;
  targetExists(slug: string, sectionId: string): Promise<boolean>;
}
export interface Matcher {
  extract(requirement: string): Promise<string[]>;
  judge(
    topic: string,
    candidates: Topic[],
  ): Promise<{
    match: 'full' | 'partial' | 'none';
    slug?: string;
    sectionId?: string;
  }>;
  generate(topic: string, existing?: Topic): Promise<string>;
}
export interface ExclusiveLock {
  run<T>(operation: () => Promise<T>): Promise<T>;
}
export interface Request {
  jobId: string;
  moduleId: string;
  requirements: string[];
  companyNames: string[];
  jdSentences: string[];
  privateNames: string[];
}

export function normalizeTopic(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/đ/gu, 'd')
    .replace(/Đ/gu, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '');
}

function similarity(first: string, second: string): number {
  if (first === second) return 1;
  if (first.includes(second) || second.includes(first))
    return (
      Math.min(first.length, second.length) /
      Math.max(first.length, second.length)
    );
  const left = new Set(first.split('-'));
  const right = new Set(second.split('-'));
  return (
    [...left].filter((word) => right.has(word)).length /
    Math.max(left.size, right.size)
  );
}

export async function autofill(
  request: Request,
  client: ContentClient,
  matcher: Matcher,
  lock: ExclusiveLock,
): Promise<{ links: Link[]; queued: string[]; prUrl: string | null }> {
  if (!/^[a-zA-Z0-9-]+$/u.test(request.jobId))
    throw new Error('Invalid job ID');
  const extracted: string[] = [];
  for (const requirement of request.requirements) {
    const topics = await matcher.extract(requirement);
    if (
      topics.length < 1 ||
      topics.length > 3 ||
      topics.some((topic) => !normalizeTopic(topic))
    )
      throw new Error('Each requirement must produce one to three topics');
    extracted.push(...topics.map(normalizeTopic));
  }
  return lock.run(async () => {
    const topics = await client.listTopics();
    const pending = await client.pendingTopics();
    const priorPr = await client.prForJob(request.jobId);
    const links: Link[] = [];
    const queued: string[] = [];
    const proposal: Proposal = { topics: [], sections: [] };
    for (const slug of new Set(extracted)) {
      const exact = topics.find((topic) => normalizeTopic(topic.slug) === slug);
      const alias = exact
        ? undefined
        : topics.find((topic) =>
            topic.aliases.some((name) => normalizeTopic(name) === slug),
          );
      const existing = exact ?? alias;
      if (existing) {
        links.push({
          moduleId: request.moduleId,
          kbSlug: existing.slug,
          sectionId: existing.sections[0]?.id ?? 'overview',
          matchType: exact ? 'exact' : 'alias',
          prUrl: null,
          state: 'live',
        });
        continue;
      }
      const alreadyPending = pending.find(
        (item) => normalizeTopic(item.slug) === slug,
      );
      if (alreadyPending) {
        links.push({
          moduleId: request.moduleId,
          kbSlug: alreadyPending.slug,
          sectionId: alreadyPending.sectionId,
          matchType: 'new',
          prUrl: alreadyPending.prUrl,
          state: 'pending',
        });
        continue;
      }
      const candidates = topics
        .map((topic) => ({
          topic,
          score: Math.max(
            ...[
              topic.title,
              ...topic.tags,
              ...topic.sections.map((section) => section.heading),
            ].map((text) => similarity(slug, normalizeTopic(text))),
          ),
        }))
        .filter((item) => item.score >= 0.45)
        .sort((first, second) => second.score - first.score)
        .slice(0, 3)
        .map((item) => item.topic);
      const judgment = candidates.length
        ? await matcher.judge(slug, candidates)
        : { match: 'none' as const };
      const matched = candidates.find((item) => item.slug === judgment.slug);
      if (judgment.match !== 'none' && !matched)
        throw new Error('Judge selected a topic outside the top three');
      if (
        judgment.match === 'full' &&
        judgment.sectionId &&
        !matched?.sections.some((section) => section.id === judgment.sectionId)
      )
        throw new Error('Judge selected a missing section');
      if (judgment.match === 'full' && matched) {
        links.push({
          moduleId: request.moduleId,
          kbSlug: matched.slug,
          sectionId:
            judgment.sectionId ?? matched.sections[0]?.id ?? 'overview',
          matchType: 'judged',
          prUrl: null,
          state: 'live',
        });
      } else if (judgment.match === 'partial' && matched) {
        const sectionId = slug;
        if (matched.sections.some((section) => section.id === sectionId)) {
          links.push({
            moduleId: request.moduleId,
            kbSlug: matched.slug,
            sectionId,
            matchType: 'partial',
            prUrl: null,
            state: 'live',
          });
          continue;
        }
        const pendingSection = pending.find(
          (item) => item.slug === matched.slug && item.sectionId === sectionId,
        );
        if (priorPr && !pendingSection) {
          queued.push(slug);
          continue;
        }
        if (
          !pendingSection &&
          !matched.sections.some((section) => section.id === sectionId) &&
          !priorPr
        )
          proposal.sections.push({
            slug: matched.slug,
            sectionId,
            content: await matcher.generate(slug, matched),
          });
        links.push({
          moduleId: request.moduleId,
          kbSlug: matched.slug,
          sectionId,
          matchType: 'partial',
          prUrl: pendingSection?.prUrl ?? null,
          state: 'pending',
        });
      } else {
        if (priorPr) {
          queued.push(slug);
          continue;
        }
        if (proposal.topics.length >= 5) {
          queued.push(slug);
          continue;
        }
        proposal.topics.push({ slug, content: await matcher.generate(slug) });
        links.push({
          moduleId: request.moduleId,
          kbSlug: slug,
          sectionId: 'overview',
          matchType: 'new',
          prUrl: null,
          state: 'pending',
        });
      }
    }
    const hasChanges = proposal.topics.length + proposal.sections.length > 0;
    let prUrl = priorPr;
    if (hasChanges && !prUrl) {
      const text = [
        ...proposal.topics.map((item) => `${item.slug}\n${item.content}`),
        ...proposal.sections.map(
          (item) => `${item.slug}\n${item.sectionId}\n${item.content}`,
        ),
      ].join('\n');
      const gate = await runGates({
        publicText: text,
        rules: {
          projectAliases: [],
          companyAliases: [],
          formerEmployerAliases: [],
          requireVueParity: false,
          unconfirmedClaims: [],
          forbiddenTerms: [...request.companyNames, ...request.privateNames],
        },
      });
      if (
        !gate.passed ||
        request.jdSentences.some(
          (sentence) =>
            sentence.trim() &&
            text.toLowerCase().includes(sentence.trim().toLowerCase()),
        )
      )
        throw new Error('Proposed knowledge failed the public-content gates');
      await client.validate(proposal);
      await client.syncIndex(proposal);
      await client.scanSecrets(proposal);
      await client.scanPersonalData(proposal);
      prUrl = await client.openPr(
        `content/kb-autofill-${request.jobId}`,
        proposal,
      );
    }
    for (const link of links) {
      if (link.state === 'pending' && !link.prUrl) link.prUrl = prUrl;
      kbRefSchema.parse({
        slug: link.kbSlug,
        sectionId: link.sectionId,
        state: link.state,
      });
    }
    return { links, queued, prUrl };
  });
}

export async function reconcile(
  links: Link[],
  prUrl: string,
  merged: boolean,
  client: Pick<ContentClient, 'targetExists'>,
): Promise<Link[]> {
  return Promise.all(
    links.map(async (link) => {
      if (link.prUrl !== prUrl || link.state !== 'pending') return link;
      return {
        ...link,
        state:
          merged && (await client.targetExists(link.kbSlug, link.sectionId))
            ? ('live' as const)
            : ('rejected' as const),
      };
    }),
  );
}

export function publicKbRef(
  link: Link,
): { slug: string; sectionId: string; state: 'live' } | null {
  return link.state === 'live'
    ? { slug: link.kbSlug, sectionId: link.sectionId, state: link.state }
    : null;
}
