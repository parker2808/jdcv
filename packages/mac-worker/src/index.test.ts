import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileJobQueue } from '@jdcv/queue';
import { SharedGateLock } from './adapters.js';
import {
  MacWorker,
  passesRubric,
  type RelayRunner,
  type Role,
  type Thread,
} from './index.js';

const exampleModule = {
  version: 2,
  requirements: [
    { id: 'frontend', title: { en: 'Frontend role', vi: 'Vai trò frontend' } },
  ],
  entries: [
    {
      id: 'entry',
      section: 'interview',
      jdRequirement: 'frontend',
      tags: [],
      title: { en: 'How?', vi: 'Làm sao?' },
      shortAnswer: { en: 'Use a sample.', vi: 'Dùng ví dụ.' },
      keyPoints: [],
      detail: { en: 'Test a sample form.', vi: 'Thử biểu mẫu mẫu.' },
      embellishmentRefs: [
        { id: 'claim', status: 'approved', defenseEntryId: 'entry' },
      ],
    },
  ],
} as const;

describe('MacWorker', () => {
  let root: string;
  let queue: FileJobQueue;
  let input: string;
  let stages: string[];
  let load: number;
  let score: number;
  let revisions: number;
  const prompts = {
    build: (
      role: Role,
      revision: number,
      paths: { module: string; interview: string; rubric: string },
    ) => JSON.stringify({ role, revision, paths }),
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'jdcv-mac-example-'));
    input = join(root, 'input.json');
    await writeFile(
      input,
      JSON.stringify({ name: 'Alex Example', jd: 'Generic frontend role' }),
    );
    queue = new FileJobQueue({ directory: join(root, 'queue') });
    stages = [];
    load = 24;
    score = 4;
    revisions = 0;
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function runner(): RelayRunner {
    return {
      async start(role) {
        stages.push(`start:${role}`);
        return { id: role, provider: 'mock', model: 'none' };
      },
      async send(thread: Thread, instructions) {
        const { revision, paths } = JSON.parse(instructions) as {
          revision: number;
          paths: { module: string; interview: string; rubric: string };
        };
        stages.push(`${thread.id}:${revision}`);
        if (thread.id === 'Generator') {
          revisions++;
          await writeFile(paths.module, JSON.stringify(exampleModule));
        }
        if (thread.id === 'Interviewer')
          await writeFile(
            paths.interview,
            JSON.stringify({ covered: ['frontend'], defended: ['claim'] }),
          );
        if (thread.id === 'Examiner')
          await writeFile(
            paths.rubric,
            JSON.stringify({
              average: score,
              mandatoryCoverage: 1,
              embellishmentDefenses: [4],
              criticalFindings: 0,
              readability: { entry: 4 },
            }),
          );
      },
      async show(thread) {
        return thread;
      },
    };
  }
  function worker() {
    return new MacWorker({
      queue,
      runner: runner(),
      prompts,
      load: { read: async () => load },
      ownerId: 'owner',
      moduleOnlyDryRun: true,
      workspaceRoot: join(root, 'jobs'),
      repoRoot: process.cwd(),
    });
  }
  const jobInput = (inputRef: string) => ({
    ownerId: 'owner',
    type: 'generate',
    route: 'mac' as const,
    payload: { inputRef },
    maxAttempts: 1,
  });

  it('claims and completes a fake job through three separate threads and D9 gates', async () => {
    const job = await queue.enqueue(jobInput(input));
    const result = await worker().runOnce();
    expect(result?.status).toBe('completed');
    expect(result?.attempts).toBe(1);
    expect(stages).toEqual([
      'start:Generator',
      'Generator:0',
      'start:Interviewer',
      'Interviewer:0',
      'start:Examiner',
      'Examiner:0',
    ]);
    expect(JSON.parse(await readFile(result!.outputRef!, 'utf8'))).toEqual(
      exampleModule,
    );
    expect(
      await queue.complete(job.id, result!.leaseToken!, result!.outputRef!),
    ).toEqual(result);
  });

  it('stops after two self-fix revisions', async () => {
    score = 3;
    await queue.enqueue(jobInput(input));
    expect((await worker().runOnce())?.status).toBe('failed');
    expect(revisions).toBe(3);
    expect(stages.filter((item) => item.startsWith('start:'))).toHaveLength(3);
  });

  it('records a failed quality result and blocks completion', async () => {
    const job = await queue.enqueue(jobInput(input));
    const guarded = new MacWorker({
      queue,
      runner: runner(),
      prompts,
      ownerId: 'owner',
      moduleOnlyDryRun: true,
      load: { read: async () => 24 },
      workspaceRoot: join(root, 'jobs'),
      repoRoot: process.cwd(),
      qualityGate: {
        run: async () => ({
          passed: false,
          failures: [{ field: 'module.entries.0', reason: 'Needs review' }],
        }),
      },
    });
    expect((await guarded.runOnce())?.status).toBe('failed');
    const saved = JSON.parse(
      await readFile(join(root, 'jobs', job.id, 'module.json'), 'utf8'),
    );
    expect(saved.qualityGate.failures).toEqual([
      { field: 'module.entries.0', reason: 'Needs review' },
    ]);
  });

  it('records an injected quality result and blocks completion on failure', async () => {
    const job = await queue.enqueue(jobInput(input));
    const guarded = new MacWorker({
      queue,
      runner: runner(),
      prompts,
      ownerId: 'owner',
      moduleOnlyDryRun: true,
      load: { read: async () => 24 },
      workspaceRoot: join(root, 'jobs'),
      repoRoot: process.cwd(),
      qualityGate: {
        run: async () => ({
          passed: false,
          failures: [{ field: 'module.entries.0', reason: 'Needs review' }],
        }),
      },
    });
    expect((await guarded.runOnce())?.status).toBe('failed');
    const saved = JSON.parse(
      await readFile(join(root, 'jobs', job.id, 'module.json'), 'utf8'),
    );
    expect(saved.qualityGate.failures).toEqual([
      { field: 'module.entries.0', reason: 'Needs review' },
    ]);
  });

  it.each([24, 25, 40, 41])(
    'admits new work only below 25 at load %i',
    async (value) => {
      load = value;
      const job = await queue.enqueue(jobInput(input));
      expect((await worker().runOnce())?.status ?? null).toBe(
        value === 24 ? 'completed' : null,
      );
      expect((await queue.get(job.id))?.status).toBe(
        value === 24 ? 'completed' : 'pending',
      );
    },
  );

  it('never runs a foreign owner job or a cloud job on the Mac', async () => {
    await queue.enqueue({ ...jobInput(input), ownerId: 'outside' });
    expect((await worker().runOnce())?.status).toBe('cancelled');
    await queue.enqueue({ ...jobInput(input), route: 'cloud' });
    expect(await worker().runOnce()).toBeNull();
    expect(stages).toEqual([]);
  });

  it('waits and rechecks at load 41 before starting a thread', async () => {
    await queue.enqueue(jobInput(input));
    let readings = 0;
    let pauses = 0;
    const guarded = new MacWorker({
      queue,
      runner: runner(),
      prompts,
      ownerId: 'owner',
      moduleOnlyDryRun: true,
      workspaceRoot: join(root, 'jobs'),
      repoRoot: process.cwd(),
      load: { read: async () => (++readings === 2 ? 41 : 24) },
      pause: async (duration) => {
        expect(duration).toBe(120_000);
        expect(stages).toEqual([]);
        pauses++;
      },
    });
    expect((await guarded.runOnce())?.status).toBe('completed');
    expect(pauses).toBe(1);
  });

  it('serializes two heavy commands under the same lock', async () => {
    const marker = join(root, 'marker.txt');
    const script = `const fs = require('node:fs'); fs.appendFileSync(process.argv[1], 'start\\n'); const end = Date.now() + 60; while (Date.now() < end) {} fs.appendFileSync(process.argv[1], 'end\\n');`;
    const lock = new SharedGateLock(join(root, 'gate.lock'), {
      read: async () => 24,
    });
    await Promise.all([
      lock.command(process.execPath, ['-e', script, marker]),
      lock.command(process.execPath, ['-e', script, marker]),
    ]);
    expect(await readFile(marker, 'utf8')).toBe('start\nend\nstart\nend\n');
  });

  it.each([25, 40])('refuses a heavy gate at load %i', async (value) => {
    const lock = new SharedGateLock(join(root, 'gate.lock'), {
      read: async () => value,
    });
    await expect(lock.command(process.execPath, ['--version'])).rejects.toThrow(
      'not admitted',
    );
  });

  it('waits two minutes and rechecks a heavy gate after load 41', async () => {
    let checks = 0;
    let pauses = 0;
    const lock = new SharedGateLock(
      join(root, 'gate.lock'),
      { read: async () => (++checks === 1 ? 41 : 24) },
      async (duration) => {
        expect(duration).toBe(120_000);
        pauses++;
      },
    );
    await lock.command(process.execPath, ['--version']);
    expect(pauses).toBe(1);
  });

  it('removes only terminal job workspaces after seven days', async () => {
    const job = await queue.enqueue(jobInput(input));
    const result = await worker().runOnce();
    const output = result!.outputRef!;
    const cleanupWorker = new MacWorker({
      queue,
      runner: runner(),
      prompts,
      ownerId: 'owner',
      moduleOnlyDryRun: true,
      workspaceRoot: join(root, 'jobs'),
      repoRoot: process.cwd(),
      load: { read: async () => 24 },
      now: () => Date.now() + 8 * 24 * 60 * 60_000,
    });
    await cleanupWorker.cleanup();
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await queue.get(job.id))?.status).toBe('completed');
  });

  it('rejects incomplete and unreadable entries even when the average passes', () => {
    const rubric = {
      average: 4,
      mandatoryCoverage: 0.5,
      embellishmentDefenses: [4],
      criticalFindings: 0,
      readability: { entry: 4 },
    };
    expect(passesRubric(exampleModule as never, rubric)).toBe(false);
    expect(
      passesRubric(exampleModule as never, {
        ...rubric,
        mandatoryCoverage: 1,
        readability: { entry: 3 },
      }),
    ).toBe(false);
    expect(
      passesRubric(exampleModule as never, {
        ...rubric,
        mandatoryCoverage: 1,
        embellishmentDefenses: [3],
      }),
    ).toBe(false);
    expect(
      passesRubric(exampleModule as never, {
        ...rubric,
        mandatoryCoverage: 1,
        criticalFindings: 1,
      }),
    ).toBe(false);
  });
});
