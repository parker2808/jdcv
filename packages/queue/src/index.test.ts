import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileJobQueue } from './index.js';

describe('FileJobQueue', () => {
  let directory: string;
  let now = 1_000_000;
  let queue: FileJobQueue;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jdcv-queue-'));
    now = 1_000_000;
    queue = new FileJobQueue({ directory, now: () => now });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const input = {
    type: 'generate',
    ownerId: 'example-owner',
    route: 'mac' as const,
    payload: { inputRef: 'private-job/example' },
  };

  it('gives a racing job to exactly one worker', async () => {
    const job = await queue.enqueue(input);
    const workers = Array.from(
      { length: 8 },
      () => new FileJobQueue({ directory, now: () => now }),
    );
    const claims = await Promise.all(
      workers.map((worker) => worker.claim('mac', 5_000)),
    );
    expect(claims.filter(Boolean).map((claimed) => claimed?.id)).toEqual([
      job.id,
    ]);
    expect((await queue.get(job.id))?.attempts).toBe(1);
    expect(await readdir(directory)).toEqual([`${job.id}.json`]);
  });

  it('deduplicates an intake key across queue instances and keeps completion idempotent', async () => {
    const secondQueue = new FileJobQueue({ directory, now: () => now });
    const [first, second] = await Promise.all([
      queue.enqueue({ ...input, idempotencyKey: 'same-message' }),
      secondQueue.enqueue({ ...input, idempotencyKey: 'same-message' }),
    ]);
    expect(second.id).toBe(first.id);
    const claim = (await queue.claim('mac', 5_000))!;
    const completed = await queue.complete(
      claim.id,
      claim.leaseToken!,
      'private-result/example',
    );
    expect(
      await secondQueue.complete(
        claim.id,
        claim.leaseToken!,
        'private-result/example',
      ),
    ).toEqual(completed);
    await expect(
      queue.fail(claim.id, claim.leaseToken!, 'late'),
    ).rejects.toThrow('Lease');
    await expect(
      queue.complete(claim.id, claim.leaseToken!, 'different'),
    ).rejects.toThrow('Lease');
    expect(await queue.claim('mac', 5_000)).toBeNull();
    expect(
      (await readFile(join(directory, `${first.id}.json`), 'utf8')).includes(
        'private-result/example',
      ),
    ).toBe(true);
  });

  it('retries with backoff, then retains the final error', async () => {
    await queue.enqueue(input);
    for (const [attempt, delay] of [
      [1, 1_000],
      [2, 2_000],
      [3, 0],
    ] as const) {
      const claim = (await queue.claim('mac', 5_000))!;
      const result = await queue.fail(
        claim.id,
        claim.leaseToken!,
        `attempt ${attempt} failed`,
      );
      expect(result.attempts).toBe(attempt);
      expect(result.status).toBe(attempt === 3 ? 'failed' : 'pending');
      expect(
        await queue.fail(
          claim.id,
          claim.leaseToken!,
          `attempt ${attempt} failed`,
        ),
      ).toEqual(result);
      expect(await queue.claim('mac', 5_000)).toBeNull();
      now += delay;
    }
    expect((await queue.list('example-owner'))[0].lastError).toBe(
      'attempt 3 failed',
    );
  });

  it('reclaims an expired lease and rejects the old worker token', async () => {
    await queue.enqueue(input);
    const first = (await queue.claim('mac', 100))!;
    now += 100;
    const second = (await queue.claim('mac', 100))!;
    expect(second.id).toBe(first.id);
    expect(second.leaseToken).not.toBe(first.leaseToken);
    await expect(
      queue.complete(first.id, first.leaseToken!, 'old'),
    ).rejects.toThrow('Lease');
    expect(
      (await queue.heartbeat(second.id, second.leaseToken!, 100))
        .leaseExpiresAt,
    ).toBe(now + 100);
  });

  it('fails a job at its 45-minute deadline and cancels idempotently', async () => {
    const expired = await queue.enqueue(input);
    now += 45 * 60_000;
    expect(await queue.claim('mac', 100)).toBeNull();
    expect((await queue.get(expired.id))?.lastError).toBe('Job timed out');
    const pending = await queue.enqueue(input);
    const cancelled = await queue.cancel(pending.id);
    expect(await queue.cancel(pending.id)).toEqual(cancelled);
    expect(await queue.claim('mac', 100)).toBeNull();
  });

  it('keeps different owners and routes separate', async () => {
    await queue.enqueue({ ...input, route: 'cloud', ownerId: 'other-owner' });
    expect(await queue.claim('mac', 100)).toBeNull();
    expect(await queue.list('example-owner')).toEqual([]);
    expect((await queue.claim('cloud', 100))?.ownerId).toBe('other-owner');
  });
});
