import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGates } from '@jdcv/gates';
import {
  createModuleLifecycle,
  type Dependencies,
  type ModuleRecord,
  type AuditRecord,
} from './index.js';

const DAY = 86_400_000;
const owner = { actorId: 'owner-1', workspaceId: 'workspace-1' };
const foreign = { actorId: 'intruder-1', workspaceId: 'workspace-1' };
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jdcv-lifecycle-'));
  roots.push(root);
  const modules = new Map<string, ModuleRecord>();
  for (const slug of ['sample-one', 'sample-two'])
    modules.set(slug, {
      id: `id-${slug}`,
      slug,
      ownerId: owner.actorId,
      workspaceId: owner.workspaceId,
      state: 'active',
      lastOpenedAt: 0,
      archivedAt: null,
      purgeAfter: null,
      warnedAt: null,
      jobIds: [`job-${slug}`],
    });
  const rows = new Map<string, Set<string>>();
  for (const kind of [
    'moduleEntries',
    'testItems',
    'testRuns',
    'cvVersions',
    'embellishments',
    'exports',
  ])
    rows.set(kind, new Set([...modules.values()].map((module) => module.id)));
  const links = [
    { moduleId: 'id-sample-one', slug: 'topic-a', state: 'live' },
    { moduleId: 'id-sample-one', slug: 'topic-b', state: 'pending' },
    { moduleId: 'id-sample-two', slug: 'topic-a', state: 'live' },
  ];
  const usage = new Map([
    ['topic-a', 2],
    ['topic-b', 0],
  ]);
  const entries = new Set(['topic-a', 'topic-b']);
  const pendingPrs = new Set(['topic-b']);
  const tombstones = new Map<
    string,
    {
      id: string;
      slug: string;
      ownerId: string;
      workspaceId: string;
      state: 'incomplete' | 'purged';
    }
  >();
  const audit: AuditRecord[] = [];
  const events: string[] = [];
  const jobs = new Map(
    [...modules.values()].map((module) => [
      module.jobIds[0],
      { id: module.jobIds[0], ownerId: owner.actorId, status: 'leased' },
    ]),
  );
  let now = 0;
  let autoEnabled = false;
  let failObject = false;
  for (const module of modules.values()) {
    await mkdir(join(root, 'objects', module.id), { recursive: true });
    await writeFile(join(root, 'objects', module.id, 'jd.txt'), 'synthetic');
    await mkdir(join(root, 'jobs', module.jobIds[0]), { recursive: true });
    await writeFile(
      join(root, 'jobs', module.jobIds[0], 'output.pdf'),
      'synthetic',
    );
  }
  const warnings: string[] = [];
  const deps: Dependencies = {
    ownerId: owner.actorId,
    clock: { now: () => now },
    lock: { run: async (_key, operation) => operation() },
    audit: {
      append: async (record) => {
        audit.push(record);
      },
    },
    records: {
      get: async (slug) => modules.get(slug) ?? null,
      list: async () => [...modules.values()],
      save: async (record) => {
        modules.set(record.slug, structuredClone(record));
      },
      getTombstone: async (slug) => tombstones.get(slug) ?? null,
      saveTombstone: async (tombstone) => {
        tombstones.set(tombstone.slug, tombstone);
      },
      deleteOwned: async (kind, moduleId) => {
        events.push(`row:${kind}`);
        rows.get(kind)!.delete(moduleId);
      },
      removeLinksAndDecrement: async (moduleId) => {
        events.push('links');
        for (const link of [...links])
          if (link.moduleId === moduleId) {
            if (link.state === 'live')
              usage.set(link.slug, usage.get(link.slug)! - 1);
            links.splice(links.indexOf(link), 1);
          }
      },
      deleteModule: async (moduleId) => {
        events.push('module');
        for (const [slug, record] of modules)
          if (record.id === moduleId) modules.delete(slug);
      },
    },
    queue: {
      get: async (id) => (jobs.get(id) as never) ?? null,
      cancel: async (id) => {
        events.push(`cancel:${id}`);
        jobs.get(id)!.status = 'cancelled';
        return jobs.get(id) as never;
      },
    },
    objects: {
      deleteForModule: async (id) => {
        events.push('objects');
        if (failObject) {
          failObject = false;
          throw new Error('object unavailable');
        }
        await rm(join(root, 'objects', id), { recursive: true, force: true });
      },
    },
    workspaces: {
      deleteJob: async (id) => {
        events.push('workspace');
        await rm(join(root, 'jobs', id), { recursive: true, force: true });
      },
    },
    notifier: {
      warn: async (_context, _moduleId, key) => {
        warnings.push(key);
      },
    },
    autoArchiveConfig: { get: async () => ({ enabled: autoEnabled }) },
  };
  return {
    service: createModuleLifecycle(deps),
    modules,
    rows,
    links,
    usage,
    entries,
    pendingPrs,
    tombstones,
    audit,
    events,
    jobs,
    warnings,
    root,
    setNow: (value: number) => {
      now = value;
    },
    enableAuto: () => {
      autoEnabled = true;
    },
    failNextObject: () => {
      failObject = true;
    },
  };
}

describe('module lifecycle', () => {
  it('AC1 refuses every non-owner mutation without touching stores', async () => {
    const test = await fixture();
    for (const command of ['archive', 'restore', 'purge', 'keep'] as const) {
      const result = await test.service[command](foreign, 'sample-one');
      expect(result).toMatchObject({ code: 'FORBIDDEN', httpStatus: 403 });
    }
    expect(test.modules.get('sample-one')?.state).toBe('active');
    expect(test.events).toEqual([]);
    expect(test.audit).toHaveLength(4);
  });

  it('AC2 AC3 archives, hides, restores on day six and only sweeps due modules', async () => {
    const test = await fixture();
    expect((await test.service.purge(owner, 'sample-one')).code).toBe(
      'NOT_ARCHIVED',
    );
    await test.service.archive(owner, 'sample-one');
    expect(await test.service.list(owner)).toHaveLength(1);
    expect(await test.service.search(owner, 'sample-one')).toEqual([]);
    test.setNow(6 * DAY);
    expect((await test.service.restore(owner, 'sample-one')).state).toBe(
      'active',
    );
    await test.service.archive(owner, 'sample-one');
    test.setNow(12 * DAY);
    expect(await test.service.purgeDue(12 * DAY)).toEqual([]);
    expect((await test.service.restore(owner, 'sample-one')).code).toBe('OK');
    await test.service.archive(owner, 'sample-one');
    test.setNow(20 * DAY);
    expect((await test.service.purgeDue(20 * DAY))[0].state).toBe('purged');
    expect((await test.service.restore(owner, 'sample-one')).code).toBe(
      'PURGED',
    );
  });

  it('AC4 AC5 AC6 purges only owned artifacts, cancels first, preserves KB and unrelated jobs', async () => {
    const test = await fixture();
    await test.service.archive(owner, 'sample-one');
    expect((await test.service.purge(owner, 'sample-one')).ok).toBe(true);
    expect(test.events[0]).toBe('cancel:job-sample-one');
    expect(test.modules.has('sample-one')).toBe(false);
    expect(test.modules.has('sample-two')).toBe(true);
    for (const row of test.rows.values())
      expect([...row]).toEqual(['id-sample-two']);
    expect(await readdir(join(test.root, 'objects'))).toEqual([
      'id-sample-two',
    ]);
    expect(await readdir(join(test.root, 'jobs'))).toEqual(['job-sample-two']);
    expect(test.jobs.get('job-sample-two')?.status).toBe('leased');
    expect(test.links).toEqual([
      { moduleId: 'id-sample-two', slug: 'topic-a', state: 'live' },
    ]);
    expect(test.usage.get('topic-a')).toBe(1);
    expect(test.usage.get('topic-b')).toBe(0);
    expect(test.entries.has('topic-b')).toBe(true);
    expect(test.pendingPrs.has('topic-b')).toBe(true);
  });

  it('AC7 repeats actions and retries a partial object deletion without a second KB decrement', async () => {
    const test = await fixture();
    expect(await test.service.archive(owner, 'sample-one')).toEqual(
      await test.service.archive(owner, 'sample-one'),
    );
    expect(await test.service.restore(owner, 'sample-one')).toEqual(
      await test.service.restore(owner, 'sample-one'),
    );
    expect(await test.service.keep(owner, 'sample-one')).toEqual(
      await test.service.keep(owner, 'sample-one'),
    );
    await test.service.archive(owner, 'sample-one');
    test.failNextObject();
    expect((await test.service.purge(owner, 'sample-one')).code).toBe(
      'PURGE_INCOMPLETE',
    );
    expect(test.tombstones.get('sample-one')?.state).toBe('incomplete');
    expect(test.usage.get('topic-a')).toBe(1);
    expect((await test.service.purge(owner, 'sample-one')).ok).toBe(true);
    expect((await test.service.purge(owner, 'sample-one')).state).toBe(
      'purged',
    );
    expect(test.usage.get('topic-a')).toBe(1);
  });

  it('AC8 requires notice and allows keep to reset inactivity', async () => {
    const test = await fixture();
    test.setNow(60 * DAY);
    expect(await test.service.autoArchive(60 * DAY)).toEqual([]);
    expect(test.warnings).toHaveLength(0);
    test.enableAuto();
    test.setNow(57 * DAY);
    await test.service.autoArchive(57 * DAY);
    expect(test.warnings).toHaveLength(2);
    test.setNow(58 * DAY);
    await test.service.keep(owner, 'sample-one');
    await test.service.keep(owner, 'sample-one');
    test.setNow(60 * DAY);
    await test.service.autoArchive(60 * DAY);
    expect(test.modules.get('sample-one')?.state).toBe('active');
    expect(test.modules.get('sample-two')?.state).toBe('archived');
    expect(test.modules.get('sample-two')?.purgeAfter).toBe(67 * DAY);
  });

  it('AC9 writes only allowlisted audit fields and passes the gates scan', async () => {
    const test = await fixture();
    await test.service.archive(owner, 'sample-one');
    await test.service.restore(owner, 'sample-one');
    await test.service.keep(owner, 'sample-one');
    await test.service.archive(owner, 'sample-one');
    await test.service.purge(owner, 'sample-one');
    for (const record of test.audit)
      expect(Object.keys(record).sort()).toEqual([
        'action',
        'actorId',
        'moduleId',
        'result',
        'timestamp',
      ]);
    expect(test.audit).toHaveLength(5);
    expect(
      (await runGates({ publicText: JSON.stringify(test.audit) })).passed,
    ).toBe(true);
  });
});
