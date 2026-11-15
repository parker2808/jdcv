import { describe, expect, it } from 'vitest';
import { runCli } from './cli.js';
import type { Dependencies } from './index.js';

describe('CLI', () => {
  it('AC11 prints one JSON line per command and uses documented exit codes', async () => {
    const audit: string[] = [];
    let state: 'active' | 'archived' = 'active';
    let exists = true;
    const record = {
      id: 'id-one',
      slug: 'sample-one',
      ownerId: 'owner-1',
      workspaceId: 'workspace-1',
      lastOpenedAt: 0,
      archivedAt: null as number | null,
      purgeAfter: null as number | null,
      warnedAt: null,
      jobIds: [] as string[],
    };
    const load = async (): Promise<Dependencies & { workspaceId: string }> => ({
      workspaceId: 'workspace-1',
      ownerId: 'owner-1',
      clock: { now: () => 0 },
      lock: { run: async (_key, operation) => operation() },
      records: {
        get: async () => (exists ? { ...record, state } : null),
        list: async () => [],
        save: async (value) => {
          state = value.state;
          record.archivedAt = value.archivedAt;
          record.purgeAfter = value.purgeAfter;
        },
        getTombstone: async () =>
          exists
            ? null
            : {
                id: record.id,
                slug: record.slug,
                ownerId: record.ownerId,
                workspaceId: record.workspaceId,
                state: 'purged',
              },
        saveTombstone: async () => {},
        deleteOwned: async () => {},
        removeLinksAndDecrement: async () => {},
        deleteModule: async () => {
          exists = false;
        },
      },
      objects: { deleteForModule: async () => {} },
      workspaces: { deleteJob: async () => {} },
      queue: {
        get: async () => null,
        cancel: async () => {
          throw new Error('Unexpected job');
        },
      },
      audit: {
        append: async (entry) => {
          audit.push(entry.action);
        },
      },
      notifier: { warn: async () => {} },
      autoArchiveConfig: { get: async () => ({ enabled: false }) },
    });
    for (const command of [
      'status',
      'archive',
      'keep',
      'restore',
      'archive',
      'purge',
    ] as const) {
      const response = await runCli(
        [command, '--slug', 'sample-one', '--actor', 'owner-1'],
        load,
      );
      expect(response.exitCode).toBe(0);
      expect(response.output.split('\n')).toHaveLength(1);
      expect(JSON.parse(response.output)).toMatchObject({
        ok: true,
        code: 'OK',
      });
    }
    const forbidden = await runCli(
      ['archive', '--slug', 'sample-one', '--actor', 'stranger'],
      load,
    );
    expect(forbidden.exitCode).toBe(2);
    expect(JSON.parse(forbidden.output)).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(audit).toHaveLength(6);
    expect((await runCli(['bad'], load)).exitCode).toBe(2);
    expect((await runCli(['--help'], load)).exitCode).toBe(0);
    const unavailable = await runCli(
      ['status', '--slug', 'sample-one', '--actor', 'owner-1'],
      async () => {
        throw new Error('unavailable');
      },
    );
    expect(unavailable.exitCode).toBe(1);
    expect(JSON.parse(unavailable.output).code).toBe('ADAPTER_FAILURE');
  });
});
