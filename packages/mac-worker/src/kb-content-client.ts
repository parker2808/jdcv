import type { ContentClient, Proposal, Topic } from '@jdcv/kb-autofill';

export type KbContentClient = ContentClient;

export class DryRunKbContentClient implements KbContentClient {
  readonly plan: { branch: string; proposal: Proposal }[] = [];
  private readonly topics: Topic[];

  constructor(topics: Topic[] = []) {
    this.topics = structuredClone(topics);
  }

  async listTopics(): Promise<Topic[]> {
    return structuredClone(this.topics);
  }

  async pendingTopics(): Promise<
    { slug: string; sectionId: string; prUrl: string }[]
  > {
    return this.plan.flatMap(({ branch, proposal }) => [
      ...proposal.topics.map(({ slug }) => ({
        slug,
        sectionId: 'overview',
        prUrl: `dry-run:${branch}`,
      })),
      ...proposal.sections.map(({ slug, sectionId }) => ({
        slug,
        sectionId,
        prUrl: `dry-run:${branch}`,
      })),
    ]);
  }

  async prForJob(jobId: string): Promise<string | null> {
    const branch = `content/kb-autofill-${jobId}`;
    return this.plan.some((item) => item.branch === branch)
      ? `dry-run:${branch}`
      : null;
  }

  async validate(): Promise<void> {}
  async syncIndex(): Promise<void> {}
  async scanSecrets(): Promise<void> {}
  async scanPersonalData(): Promise<void> {}

  async openPr(branch: string, proposal: Proposal): Promise<string> {
    this.plan.push({ branch, proposal: structuredClone(proposal) });
    return `dry-run:${branch}`;
  }

  async targetExists(slug: string, sectionId: string): Promise<boolean> {
    return this.topics.some(
      (topic) =>
        topic.slug === slug &&
        topic.sections.some((section) => section.id === sectionId),
    );
  }
}
