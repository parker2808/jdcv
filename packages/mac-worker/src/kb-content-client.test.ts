import { describe, expect, it } from 'vitest';
import { DryRunKbContentClient } from './kb-content-client.js';

describe('dry-run KB content client', () => {
  it('reads a copied fixture and records only an in-memory proposal', async () => {
    const topics = [
      {
        slug: 'example-existing',
        title: 'Example topic',
        aliases: ['example-alias'],
        tags: [],
        sections: [{ id: 'overview', heading: 'Overview' }],
      },
    ];
    const client = new DryRunKbContentClient(topics);
    topics[0]!.aliases.push('changed-outside');
    expect((await client.listTopics())[0]?.aliases).toEqual(['example-alias']);
    const fetched = await client.listTopics();
    fetched[0]!.sections[0]!.heading = 'Changed locally';
    expect((await client.listTopics())[0]?.sections[0]?.heading).toBe(
      'Overview',
    );

    const proposal = {
      topics: [{ slug: 'example-topic', content: 'A general example.' }],
      sections: [],
    };
    await client.validate(proposal);
    await client.syncIndex(proposal);
    await client.scanSecrets(proposal);
    await client.scanPersonalData(proposal);
    expect(
      await client.openPr('content/kb-autofill-example-job', proposal),
    ).toBe('dry-run:content/kb-autofill-example-job');
    proposal.topics[0]!.content = 'Changed outside';
    expect(client.plan[0]?.proposal.topics[0]?.content).toBe(
      'A general example.',
    );
    expect(await client.prForJob('example-job')).toBe(
      'dry-run:content/kb-autofill-example-job',
    );
    expect(await client.pendingTopics()).toEqual([
      {
        slug: 'example-topic',
        sectionId: 'overview',
        prUrl: 'dry-run:content/kb-autofill-example-job',
      },
    ]);
    expect(await client.targetExists('example-existing', 'overview')).toBe(
      true,
    );
    expect(await client.targetExists('example-topic', 'overview')).toBe(false);
  });
});
