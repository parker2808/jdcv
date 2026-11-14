import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  autofill,
  normalizeTopic,
  publicKbRef,
  reconcile,
  type ContentClient,
  type ExclusiveLock,
  type Matcher,
  type Proposal,
  type Request,
  type Topic,
} from './index.js';

const known: Topic = {
  slug: 'focus-management',
  title: 'Quản lý bàn phím',
  aliases: ['keyboard-navigation'],
  tags: ['accessibility'],
  sections: [{ id: 'focus', heading: 'Focus behavior' }],
};
const request: Request = {
  jobId: 'job-1',
  moduleId: 'module-1',
  requirements: ['sample requirement'],
  companyNames: ['Sample Corp'],
  jdSentences: ['Sample Corp needs a senior specialist'],
  privateNames: ['internal-repository'],
};
let directory: string;
let chain: Promise<void>;
const lock: ExclusiveLock = {
  async run(operation) {
    const previous = chain;
    let release!: () => void;
    chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  },
};

function fakeClient() {
  const proposals: { branch: string; proposal: Proposal; url: string }[] = [];
  const calls: string[] = [];
  const client: ContentClient = {
    async listTopics() {
      return JSON.parse(
        await readFile(join(directory, 'topics.json'), 'utf8'),
      ) as Topic[];
    },
    async pendingTopics() {
      return proposals.flatMap((entry) =>
        entry.proposal.topics.map((topic) => ({
          slug: topic.slug,
          sectionId: 'overview',
          prUrl: entry.url,
        })),
      );
    },
    async prForJob(jobId) {
      return (
        proposals.find(
          (entry) => entry.branch === `content/kb-autofill-${jobId}`,
        )?.url ?? null
      );
    },
    async validate() {
      calls.push('validate');
    },
    async syncIndex() {
      calls.push('sync');
    },
    async scanSecrets() {
      calls.push('secrets');
    },
    async scanPersonalData() {
      calls.push('personal');
    },
    async openPr(branch, proposal) {
      calls.push('pr');
      const url = 'https://example.test/pr/1';
      proposals.push({ branch, proposal, url });
      return url;
    },
    async targetExists(slug, sectionId) {
      return slug === 'focus-management' && sectionId === 'focus';
    },
  };
  return { client, calls, proposals };
}
function matcherFor(
  topics: string[],
  match: 'full' | 'partial' | 'none' = 'none',
  generated?: string,
): Matcher {
  return {
    async extract() {
      return topics;
    },
    async judge(_, candidates) {
      return {
        match,
        slug: candidates[0]?.slug,
        sectionId: candidates[0]?.sections[0]?.id,
      };
    },
    async generate(topic) {
      return (
        generated ??
        `The ${topic} topic explains a general concept. For example, a fictional page can demonstrate it.`
      );
    },
  };
}
describe('knowledge autofill', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jdcv-kb-example-'));
    chain = Promise.resolve();
    await writeFile(join(directory, 'topics.json'), JSON.stringify([known]));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('normalizes accents and rejects missing extracted topics', async () => {
    expect(normalizeTopic('Quản lý bàn phím')).toBe('quan-ly-ban-phim');
    await expect(
      autofill(request, fakeClient().client, matcherFor([]), lock),
    ).rejects.toThrow('one to three');
    await expect(
      autofill(
        request,
        fakeClient().client,
        matcherFor(['one', 'two', 'three', 'four']),
        lock,
      ),
    ).rejects.toThrow('one to three');
  });
  it.each([
    ['exact slug', 'focus-management', 'none', 'exact'],
    ['alias', 'keyboard-navigation', 'none', 'alias'],
    ['accent-insensitive fuzzy title', 'quan-ly-ban-phim', 'full', 'judged'],
    ['LLM-judged full match', 'focus-behavior', 'full', 'judged'],
  ] as const)(
    '%s links without a new topic',
    async (_, topic, match, matchType) => {
      const { client, proposals } = fakeClient();
      const result = await autofill(
        request,
        client,
        matcherFor([topic], match),
        lock,
      );
      expect(result.links[0]).toMatchObject({
        kbSlug: known.slug,
        state: 'live',
        matchType,
      });
      expect(result.prUrl).toBeNull();
      expect(proposals).toHaveLength(0);
    },
  );
  it('proposes a section rather than a topic for a partial match', async () => {
    const { client, proposals, calls } = fakeClient();
    const result = await autofill(
      request,
      client,
      matcherFor(['focus-behavior'], 'partial'),
      lock,
    );
    expect(result.links[0]).toMatchObject({
      kbSlug: known.slug,
      state: 'pending',
      matchType: 'partial',
    });
    expect(proposals[0]?.proposal.topics).toEqual([]);
    expect(proposals[0]?.proposal.sections).toHaveLength(1);
    expect(calls).toEqual(['validate', 'sync', 'secrets', 'personal', 'pr']);
    expect(publicKbRef(result.links[0]!)).toBeNull();
  });
  it('limits seven misses to five new topics and queues two', async () => {
    const { client, proposals } = fakeClient();
    const many: Request = { ...request, requirements: ['a', 'b', 'c'] };
    let index = 0;
    const matcher = {
      ...matcherFor([]),
      extract: async () =>
        [
          ['miss-one', 'miss-two', 'miss-three'],
          ['miss-four', 'miss-five', 'miss-six'],
          ['miss-seven'],
        ][index++]!,
    };
    const result = await autofill(
      { ...many, jobId: 'job-2' },
      client,
      matcher,
      lock,
    );
    expect(result.queued).toEqual(['miss-six', 'miss-seven']);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.proposal.topics).toHaveLength(5);
    expect(proposals[0]?.branch).toBe('content/kb-autofill-job-2');
  });
  it('serializes two missing-topic runs and opens only one entry', async () => {
    const { client, proposals } = fakeClient();
    const results = await Promise.all([
      autofill(request, client, matcherFor(['never-seen']), lock),
      autofill(
        { ...request, jobId: 'job-2' },
        client,
        matcherFor(['never-seen']),
        lock,
      ),
    ]);
    expect(proposals).toHaveLength(1);
    expect(results[1]?.links[0]?.prUrl).toBe(results[0]?.prUrl);
  });
  it.each([
    'Sample Corp',
    'Sample Corp needs a senior specialist',
    'internal-repository',
    'sample@example.test',
  ])('blocks unsafe generated content', async (unsafe) => {
    const { client, proposals } = fakeClient();
    await expect(
      autofill(
        request,
        client,
        matcherFor(['new-topic'], 'none', `The topic is ${unsafe}.`),
        lock,
      ),
    ).rejects.toThrow('public-content gates');
    expect(proposals).toEqual([]);
  });
  it('promotes only verified merged targets and rejects closed or missing ones', async () => {
    const { client } = fakeClient();
    const links = [
      {
        moduleId: 'module-1',
        kbSlug: known.slug,
        sectionId: 'focus',
        matchType: 'partial' as const,
        prUrl: 'pr-1',
        state: 'pending' as const,
      },
    ];
    expect((await reconcile(links, 'pr-1', true, client))[0]?.state).toBe(
      'live',
    );
    expect((await reconcile(links, 'pr-1', false, client))[0]?.state).toBe(
      'rejected',
    );
    expect(
      (
        await reconcile(
          [{ ...links[0]!, sectionId: 'missing' }],
          'pr-1',
          true,
          client,
        )
      )[0]?.state,
    ).toBe('rejected');
  });
});
