import type { JobQueue } from '@jdcv/queue';
export { planPhase1Removal, type GitPlanClient } from './git-plan.js';

export type State = 'active' | 'archived' | 'purged';
export type Action = 'archive' | 'restore' | 'purge' | 'keep' | 'warn';
export type Code =
  | 'OK'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NOT_ARCHIVED'
  | 'PURGED'
  | 'PURGE_INCOMPLETE'
  | 'NOTICE_REQUIRED';
export interface Context {
  actorId: string;
  workspaceId: string;
}
export interface ModuleRecord {
  id: string;
  slug: string;
  ownerId: string;
  workspaceId: string;
  state: 'active' | 'archived';
  lastOpenedAt: number;
  archivedAt: number | null;
  purgeAfter: number | null;
  warnedAt: number | null;
  jobIds: string[];
}
export interface Tombstone {
  id: string;
  slug: string;
  ownerId: string;
  workspaceId: string;
  state: 'incomplete' | 'purged';
}
export interface Result {
  ok: boolean;
  state: State | null;
  code: Code;
  message: string;
  httpStatus: number;
}
export interface RecordStore {
  get(slug: string): Promise<ModuleRecord | null>;
  list(): Promise<ModuleRecord[]>;
  save(record: ModuleRecord): Promise<void>;
  getTombstone(slug: string): Promise<Tombstone | null>;
  saveTombstone(tombstone: Tombstone): Promise<void>;
  deleteOwned(
    kind:
      | 'moduleEntries'
      | 'testItems'
      | 'testRuns'
      | 'cvVersions'
      | 'embellishments'
      | 'exports',
    moduleId: string,
  ): Promise<void>;
  removeLinksAndDecrement(moduleId: string): Promise<void>;
  deleteModule(moduleId: string): Promise<void>;
}
export interface ObjectStore {
  deleteForModule(moduleId: string): Promise<void>;
}
export interface WorkspaceStore {
  deleteJob(jobId: string): Promise<void>;
}
export interface AuditRecord {
  actorId: string;
  action: Action;
  moduleId: string;
  timestamp: number;
  result: Code;
}
export interface Dependencies {
  ownerId: string;
  records: RecordStore;
  objects: ObjectStore;
  workspaces: WorkspaceStore;
  queue: Pick<JobQueue, 'get' | 'cancel'>;
  lock: { run<T>(moduleId: string, operation: () => Promise<T>): Promise<T> };
  audit: { append(record: AuditRecord): Promise<void> };
  clock: { now(): number };
  notifier: {
    warn(context: Context, moduleId: string, key: string): Promise<void>;
  };
  autoArchiveConfig: {
    get(workspaceId: string): Promise<{ enabled: boolean; days?: number }>;
  };
  git?: { planRemoval(slug: string): Promise<void> };
}

const DAY = 86_400_000;
const kinds = [
  'moduleEntries',
  'testItems',
  'testRuns',
  'cvVersions',
  'embellishments',
  'exports',
] as const;

function result(code: Code, state: State | null): Result {
  const status = {
    OK: 200,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    NOT_ARCHIVED: 409,
    PURGED: 410,
    PURGE_INCOMPLETE: 409,
    NOTICE_REQUIRED: 409,
  }[code];
  const message = {
    OK: 'Operation completed',
    FORBIDDEN: 'Only the module owner may perform this action',
    NOT_FOUND: 'Module not found',
    NOT_ARCHIVED: 'Archive the module before purging',
    PURGED: 'Module was purged',
    PURGE_INCOMPLETE: 'Purge incomplete; retry safely',
    NOTICE_REQUIRED: 'Warning must be delivered before auto-archive',
  }[code];
  return { ok: code === 'OK', state, code, message, httpStatus: status };
}

export function createModuleLifecycle(deps: Dependencies) {
  async function lookup(context: Context, slug: string) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug))
      return {
        record: null,
        tombstone: null,
        denied: result('NOT_FOUND', null),
      };
    const record = await deps.records.get(slug);
    const tombstone = record ? null : await deps.records.getTombstone(slug);
    if (!record && !tombstone)
      return { record, tombstone, denied: result('NOT_FOUND', null) };
    if (
      context.actorId !== deps.ownerId ||
      context.actorId !== (record ?? tombstone)!.ownerId ||
      context.workspaceId !== (record ?? tombstone)!.workspaceId
    )
      return { record, tombstone, denied: result('FORBIDDEN', null) };
    return { record, tombstone, denied: null };
  }

  async function mutate(
    context: Context,
    slug: string,
    action: Exclude<Action, 'warn'>,
  ): Promise<Result> {
    return deps.lock.run(slug, async () => {
      const { record, tombstone, denied } = await lookup(context, slug);
      if (denied && !record && !tombstone) return denied;
      let outcome: Result;
      try {
        if (denied) outcome = denied;
        else if (!record)
          outcome = result(
            tombstone!.state === 'incomplete'
              ? 'PURGE_INCOMPLETE'
              : action === 'restore'
                ? 'PURGED'
                : 'OK',
            'purged',
          );
        else if (action === 'archive') {
          if (record.state === 'active') {
            record.state = 'archived';
            record.archivedAt = deps.clock.now();
            record.purgeAfter = record.archivedAt + 7 * DAY;
            await deps.records.save(record);
          }
          outcome = result('OK', 'archived');
        } else if (action === 'restore') {
          if (record.state === 'archived') {
            if (deps.clock.now() >= record.purgeAfter!)
              outcome = result('PURGED', 'archived');
            else {
              record.state = 'active';
              record.archivedAt = null;
              record.purgeAfter = null;
              record.lastOpenedAt = deps.clock.now();
              record.warnedAt = null;
              await deps.records.save(record);
              outcome = result('OK', 'active');
            }
          } else outcome = result('OK', 'active');
        } else if (action === 'keep') {
          if (record.state === 'active' && record.warnedAt !== null) {
            record.lastOpenedAt = deps.clock.now();
            record.warnedAt = null;
            await deps.records.save(record);
          }
          outcome = result('OK', record.state);
        } else if (record.state !== 'archived')
          outcome = result('NOT_ARCHIVED', record.state);
        else {
          await deps.records.saveTombstone({
            id: record.id,
            slug,
            ownerId: record.ownerId,
            workspaceId: record.workspaceId,
            state: 'incomplete',
          });
          for (const jobId of record.jobIds) {
            const job = await deps.queue.get(jobId);
            if (
              job &&
              job.ownerId === record.ownerId &&
              (job.status === 'pending' || job.status === 'leased')
            )
              await deps.queue.cancel(jobId);
          }
          for (const kind of kinds)
            await deps.records.deleteOwned(kind, record.id);
          await deps.records.removeLinksAndDecrement(record.id);
          await deps.objects.deleteForModule(record.id);
          for (const jobId of record.jobIds)
            await deps.workspaces.deleteJob(jobId);
          if (deps.git) await deps.git.planRemoval(slug);
          await deps.records.saveTombstone({
            id: record.id,
            slug,
            ownerId: record.ownerId,
            workspaceId: record.workspaceId,
            state: 'purged',
          });
          await deps.records.deleteModule(record.id);
          outcome = result('OK', 'purged');
        }
      } catch {
        if (action !== 'purge') throw new Error('Lifecycle operation failed');
        outcome = result('PURGE_INCOMPLETE', 'archived');
      }
      await deps.audit.append({
        actorId: context.actorId,
        action,
        moduleId: (record ?? tombstone)!.id,
        timestamp: deps.clock.now(),
        result: outcome.code,
      });
      return outcome;
    });
  }

  async function status(context: Context, slug: string): Promise<Result> {
    const { record, tombstone, denied } = await lookup(context, slug);
    if (denied) return denied;
    return result(
      tombstone?.state === 'incomplete' ? 'PURGE_INCOMPLETE' : 'OK',
      record?.state ?? 'purged',
    );
  }

  async function list(context: Context): Promise<ModuleRecord[]> {
    if (context.actorId !== deps.ownerId) return [];
    return (await deps.records.list()).filter(
      (record) =>
        record.ownerId === context.actorId &&
        record.workspaceId === context.workspaceId &&
        record.state === 'active',
    );
  }

  async function search(
    context: Context,
    query: string,
  ): Promise<ModuleRecord[]> {
    return (await list(context)).filter((record) =>
      record.slug.includes(query),
    );
  }

  async function purgeDue(now: number): Promise<Result[]> {
    const due = (await deps.records.list()).filter(
      (record) =>
        record.state === 'archived' &&
        record.purgeAfter !== null &&
        record.purgeAfter <= now,
    );
    return Promise.all(
      due.map((record) =>
        mutate(
          { actorId: record.ownerId, workspaceId: record.workspaceId },
          record.slug,
          'purge',
        ),
      ),
    );
  }

  async function autoArchive(now: number): Promise<Result[]> {
    const outcomes: Result[] = [];
    for (const candidate of await deps.records.list()) {
      await deps.lock.run(candidate.slug, async () => {
        const record = await deps.records.get(candidate.slug);
        if (
          !record ||
          record.state !== 'active' ||
          record.ownerId !== deps.ownerId
        )
          return;
        const config = await deps.autoArchiveConfig.get(record.workspaceId);
        if (!config.enabled) return;
        const days = config.days ?? 60;
        if (!Number.isSafeInteger(days) || days < 4)
          throw new Error('Auto-archive days must be at least four');
        const age = now - record.lastOpenedAt;
        if (age < (days - 3) * DAY) return;
        const context = {
          actorId: record.ownerId,
          workspaceId: record.workspaceId,
        };
        if (record.warnedAt === null) {
          await deps.notifier.warn(
            context,
            record.id,
            `${record.id}:${record.lastOpenedAt}`,
          );
          record.warnedAt = now;
          await deps.records.save(record);
          await deps.audit.append({
            actorId: context.actorId,
            action: 'warn',
            moduleId: record.id,
            timestamp: now,
            result: 'OK',
          });
        } else if (age >= days * DAY && now - record.warnedAt >= 3 * DAY) {
          record.state = 'archived';
          record.archivedAt = now;
          record.purgeAfter = now + 7 * DAY;
          await deps.records.save(record);
          await deps.audit.append({
            actorId: context.actorId,
            action: 'archive',
            moduleId: record.id,
            timestamp: now,
            result: 'OK',
          });
          outcomes.push(result('OK', 'archived'));
        }
      });
    }
    return outcomes;
  }

  return {
    archive: (context: Context, slug: string) =>
      mutate(context, slug, 'archive'),
    restore: (context: Context, slug: string) =>
      mutate(context, slug, 'restore'),
    purge: (context: Context, slug: string) => mutate(context, slug, 'purge'),
    keep: (context: Context, slug: string) => mutate(context, slug, 'keep'),
    status,
    list,
    search,
    purgeDue,
    autoArchive,
  };
}
