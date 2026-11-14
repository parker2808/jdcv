import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type JobStatus =
  'pending' | 'leased' | 'completed' | 'failed' | 'cancelled';
export type JobRoute = 'mac' | 'cloud';

export interface Job {
  id: string;
  type: string;
  ownerId: string;
  route: JobRoute;
  payload: { inputRef: string };
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  leaseToken: string | null;
  leaseExpiresAt: number | null;
  availableAt: number;
  deadlineAt: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  outputRef: string | null;
  lastError: string | null;
}

export interface NewJob {
  type: string;
  ownerId: string;
  route: JobRoute;
  payload: { inputRef: string };
  idempotencyKey?: string;
  maxAttempts?: number;
}

export interface JobQueue {
  enqueue(input: NewJob): Promise<Job>;
  claim(route: JobRoute, leaseMs: number): Promise<Job | null>;
  heartbeat(id: string, leaseToken: string, leaseMs: number): Promise<Job>;
  complete(id: string, leaseToken: string, outputRef: string): Promise<Job>;
  fail(id: string, leaseToken: string, error: string): Promise<Job>;
  cancel(id: string): Promise<Job>;
  get(id: string): Promise<Job | null>;
  list(ownerId?: string): Promise<Job[]>;
}

export interface FileJobQueueOptions {
  directory?: string;
  now?: () => number;
}

const JOB_TIMEOUT_MS = 45 * 60_000;
const LOCK_STALE_MS = 120_000;

export class FileJobQueue implements JobQueue {
  private readonly directory: string;
  private readonly now: () => number;

  constructor(options: FileJobQueueOptions = {}) {
    this.directory =
      options.directory ??
      process.env.JDCV_QUEUE_DIR ??
      join(homedir(), '.jdcv', 'queue');
    this.now = options.now ?? Date.now;
  }

  private path(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid job ID');
    return join(this.directory, `${id}.json`);
  }

  private async read(id: string): Promise<Job | null> {
    try {
      return JSON.parse(await readFile(this.path(id), 'utf8')) as Job;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  private async save(job: Job): Promise<void> {
    const temporary = join(this.directory, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(job), {
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temporary, this.path(job.id));
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!isMissing(error)) throw error;
      });
    }
  }

  private async locked<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lockPath = join(this.directory, '.lock');
    for (let attempt = 0; attempt < 2_000; attempt++) {
      try {
        const lock = await open(lockPath, 'wx', 0o600);
        try {
          return await action();
        } finally {
          await lock.close();
          await unlink(lockPath);
        }
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error;
        try {
          if (Date.now() - (await stat(lockPath)).mtimeMs > LOCK_STALE_MS) {
            await unlink(lockPath);
          }
        } catch (checkError) {
          if (!isMissing(checkError)) throw checkError;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    throw new Error('Queue lock timed out');
  }

  async enqueue(input: NewJob): Promise<Job> {
    if (!input.ownerId || !input.type || !input.payload.inputRef)
      throw new Error('Missing job fields');
    if (input.route !== 'mac' && input.route !== 'cloud')
      throw new Error('Invalid route');
    if (
      input.maxAttempts !== undefined &&
      (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1)
    ) {
      throw new Error('Invalid maxAttempts');
    }
    if (input.idempotencyKey === '') throw new Error('Empty idempotency key');
    return this.locked(async () => {
      const id = input.idempotencyKey
        ? createHash('sha256')
            .update(JSON.stringify([input.ownerId, input.idempotencyKey]))
            .digest('hex')
            .slice(0, 32)
            .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
        : randomUUID();
      const existing = await this.read(id);
      if (existing) return existing;
      const now = this.now();
      const job: Job = {
        id,
        type: input.type,
        ownerId: input.ownerId,
        route: input.route,
        payload: input.payload,
        status: 'pending',
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 3,
        leaseToken: null,
        leaseExpiresAt: null,
        availableAt: now,
        deadlineAt: now + JOB_TIMEOUT_MS,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        outputRef: null,
        lastError: null,
      };
      await this.save(job);
      return job;
    });
  }

  private async all(): Promise<Job[]> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const files = (await readdir(this.directory)).filter((name) =>
      /^[a-f0-9-]{36}\.json$/.test(name),
    );
    return Promise.all(
      files.map(async (name) => (await this.read(name.slice(0, -5)))!),
    );
  }

  async claim(route: JobRoute, leaseMs: number): Promise<Job | null> {
    assertLease(leaseMs);
    if (route !== 'mac' && route !== 'cloud') throw new Error('Invalid route');
    return this.locked(async () => {
      const now = this.now();
      const jobs = (await this.all()).sort(
        (first, second) => first.createdAt - second.createdAt,
      );
      for (const job of jobs) {
        if (job.status !== 'pending' && job.status !== 'leased') continue;
        if (now >= job.deadlineAt) {
          job.status = 'failed';
          job.lastError = 'Job timed out';
          job.leaseToken = null;
          job.leaseExpiresAt = null;
          job.updatedAt = now;
          await this.save(job);
          continue;
        }
        if (
          job.route !== route ||
          (job.status === 'leased' && now < job.leaseExpiresAt!)
        )
          continue;
        if (job.status === 'pending' && now < job.availableAt) continue;
        if (job.attempts >= job.maxAttempts) {
          job.status = 'failed';
          job.lastError ??= 'Lease expired';
          job.leaseToken = null;
          job.leaseExpiresAt = null;
          job.updatedAt = now;
          await this.save(job);
          continue;
        }
        job.status = 'leased';
        job.attempts++;
        job.leaseToken = randomUUID();
        job.leaseExpiresAt = Math.min(now + leaseMs, job.deadlineAt);
        job.updatedAt = now;
        await this.save(job);
        return job;
      }
      return null;
    });
  }

  private async transition(
    id: string,
    token: string,
    update: (job: Job, now: number) => void,
    repeated?: (job: Job) => boolean,
  ): Promise<Job> {
    return this.locked(async () => {
      const job = await this.read(id);
      if (!job) throw new Error('Job not found');
      if (job.leaseToken === token && repeated?.(job)) return job;
      const now = this.now();
      if (
        job.status !== 'leased' ||
        job.leaseToken !== token ||
        now >= job.leaseExpiresAt! ||
        now >= job.deadlineAt
      ) {
        throw new Error('Lease is no longer valid');
      }
      update(job, now);
      job.updatedAt = now;
      await this.save(job);
      return job;
    });
  }

  heartbeat(id: string, leaseToken: string, leaseMs: number): Promise<Job> {
    assertLease(leaseMs);
    return this.transition(id, leaseToken, (job, now) => {
      job.leaseExpiresAt = Math.min(now + leaseMs, job.deadlineAt);
    });
  }

  complete(id: string, leaseToken: string, outputRef: string): Promise<Job> {
    if (!outputRef) throw new Error('Missing output reference');
    return this.transition(
      id,
      leaseToken,
      (job, now) => {
        job.status = 'completed';
        job.outputRef = outputRef;
        job.completedAt = now;
        job.leaseExpiresAt = null;
      },
      (job) => job.status === 'completed' && job.outputRef === outputRef,
    );
  }

  fail(id: string, leaseToken: string, error: string): Promise<Job> {
    if (!error) throw new Error('Missing error');
    return this.transition(
      id,
      leaseToken,
      (job, now) => {
        job.lastError = error;
        job.leaseExpiresAt = null;
        job.status = job.attempts >= job.maxAttempts ? 'failed' : 'pending';
        job.availableAt =
          now + Math.min(60_000, 1_000 * 2 ** Math.min(job.attempts - 1, 16));
      },
      (job) =>
        (job.status === 'pending' || job.status === 'failed') &&
        job.lastError === error,
    );
  }

  cancel(id: string): Promise<Job> {
    return this.locked(async () => {
      const job = await this.read(id);
      if (!job) throw new Error('Job not found');
      if (job.status === 'pending' || job.status === 'leased') {
        job.status = 'cancelled';
        job.leaseToken = null;
        job.leaseExpiresAt = null;
        job.updatedAt = this.now();
        await this.save(job);
      }
      return job;
    });
  }

  get(id: string): Promise<Job | null> {
    return this.read(id);
  }

  async list(ownerId?: string): Promise<Job[]> {
    return (await this.all()).filter(
      (job) => ownerId === undefined || job.ownerId === ownerId,
    );
  }
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

function isMissing(error: unknown): boolean {
  return hasCode(error, 'ENOENT');
}

function assertLease(leaseMs: number): void {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1)
    throw new Error('Invalid lease duration');
}
