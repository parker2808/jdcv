import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import {
  moduleV2Schema,
  type ModuleV2,
  type QualityGateResult,
} from '@jdcv/contracts';
import type { Job, JobQueue } from '@jdcv/queue';
import {
  autofill,
  normalizeTopic,
  type ExclusiveLock,
  type Matcher,
} from '@jdcv/kb-autofill';
import { createCvProposal, PrivateCvError } from './cv-proposal.js';
import {
  DryRunKbContentClient,
  type KbContentClient,
} from './kb-content-client.js';

export {
  DryRunKbContentClient,
  type KbContentClient,
} from './kb-content-client.js';

export type Role = 'Generator' | 'Interviewer' | 'Examiner';
export interface Thread {
  id: string;
  provider: string;
  model: string;
}
export interface RelayRunner {
  start(
    role: Role,
    promptFile: string,
    workspace: string,
    signal: AbortSignal,
  ): Promise<Thread>;
  send(
    thread: Thread,
    instructions: string,
    signal: AbortSignal,
  ): Promise<void>;
  show(thread: Thread, signal: AbortSignal): Promise<Thread>;
}
export interface PromptBuilder {
  build(
    role: Role,
    revision: number,
    paths: { input: string; module: string; interview: string; rubric: string },
  ): string;
}
export interface LoadReader {
  read(): Promise<number>;
}
export interface GateLock {
  command(command: string, args?: string[]): Promise<void>;
}
export interface Rubric {
  average: number;
  mandatoryCoverage: number;
  embellishmentDefenses: number[];
  criticalFindings: number;
  readability: Record<string, number>;
}
export interface WorkerOptions {
  queue: JobQueue;
  runner: RelayRunner;
  prompts: PromptBuilder;
  load: LoadReader;
  qualityGate?: { run(module: ModuleV2, job: Job): Promise<QualityGateResult> };
  kbClient?: KbContentClient;
  kbMatcher?: Matcher;
  kbLock?: ExclusiveLock;
  moduleOnlyDryRun?: boolean;
  privateCvDirectory?: string;
  cvSource?: 'docx' | 'portfolio';
  portfolioApiUrl?: string;
  portfolioLocale?: 'en' | 'vi';
  portfolioFetch?: typeof fetch;
  ownerId: string;
  workspaceRoot?: string;
  repoRoot?: string;
  now?: () => number;
  pause?: (ms: number) => Promise<void>;
  log?: (
    event:
      | {
          env: 't3-lil.parker';
          jobId: string;
          role: Role;
          threadId: string;
          provider: string;
          model: string;
          switch: boolean;
        }
      | {
          env: 't3-lil.parker';
          jobId: string;
          cvSource: 'docx' | 'portfolio';
        },
  ) => void;
}

const LEASE_MS = 60_000;
const LIMIT_BYTES = 6144;

function inside(path: string, parent: string): boolean {
  const remainder = relative(parent, path);
  return !remainder.startsWith('..') && !isAbsolute(remainder);
}

export function passesRubric(module: ModuleV2, rubric: Rubric): boolean {
  return (
    Number.isFinite(rubric.average) &&
    rubric.average >= 4 &&
    rubric.average <= 5 &&
    rubric.mandatoryCoverage === 1 &&
    rubric.criticalFindings === 0 &&
    module.entries.every((entry) =>
      (entry.embellishmentRefs ?? []).every((ref) => ref.status === 'approved'),
    ) &&
    module.entries.every(
      (entry) =>
        Number.isFinite(rubric.readability[entry.id]) &&
        rubric.readability[entry.id] >= 4 &&
        rubric.readability[entry.id] <= 5,
    ) &&
    module.entries.flatMap((entry) => entry.embellishmentRefs ?? []).length ===
      rubric.embellishmentDefenses.length &&
    rubric.embellishmentDefenses.every(
      (score) => Number.isFinite(score) && score >= 4 && score <= 5,
    )
  );
}

export class MacWorker {
  private readonly now: () => number;
  private readonly pause: (ms: number) => Promise<void>;
  private readonly kbClient: KbContentClient;

  constructor(private readonly options: WorkerOptions) {
    if (!options.ownerId) throw new Error('Owner ID is required');
    this.now = options.now ?? Date.now;
    this.pause =
      options.pause ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
    this.kbClient = options.kbClient ?? new DryRunKbContentClient();
    if (!(this.kbClient instanceof DryRunKbContentClient) && !options.kbLock)
      throw new Error(
        'An injected content client requires an exclusive KB lock',
      );
  }

  private async admission(
    existing: boolean,
    wait = false,
    signal?: AbortSignal,
  ): Promise<boolean> {
    for (;;) {
      if (signal?.aborted) throw new Error('Job timed out');
      const load = await this.options.load.read();
      if (!Number.isFinite(load) || load < 0)
        throw new Error('Invalid Mac load');
      if (load > 40) {
        if (!existing && !wait) return false;
        await this.pause(120_000);
        continue;
      }
      if (existing || load < 25) return true;
      if (!wait) return false;
      await this.pause(120_000);
    }
  }

  async runOnce(): Promise<Job | null> {
    if (!(await this.admission(false))) return null;
    const job = await this.options.queue.claim('mac', LEASE_MS);
    if (!job) return null;
    if (job.ownerId !== this.options.ownerId || job.route !== 'mac') {
      return this.options.queue.cancel(job.id);
    }
    const controller = new AbortController();
    const remaining = job.deadlineAt - this.now();
    if (remaining <= 0) {
      return this.options.queue.fail(job.id, job.leaseToken!, 'Job timed out');
    }
    const deadline = setTimeout(() => controller.abort(), remaining);
    const heartbeat = setInterval(() => {
      void this.options.queue
        .heartbeat(job.id, job.leaseToken!, LEASE_MS)
        .catch(() => controller.abort());
    }, LEASE_MS / 2);
    try {
      const outputRef = await this.process(job, controller.signal);
      if (controller.signal.aborted || this.now() >= job.deadlineAt)
        throw new Error('Job timed out');
      return await this.options.queue.complete(
        job.id,
        job.leaseToken!,
        outputRef,
      );
    } catch (error) {
      const message = controller.signal.aborted
        ? 'Job timed out'
        : error instanceof PrivateCvError
          ? error.code
          : error instanceof RubricFailure
            ? 'Quality gate failed'
            : 'Worker execution failed';
      return this.options.queue.fail(job.id, job.leaseToken!, message);
    } finally {
      clearTimeout(deadline);
      clearInterval(heartbeat);
    }
  }

  async cleanup(): Promise<void> {
    const root = this.options.workspaceRoot ?? join(homedir(), '.jdcv', 'jobs');
    if (!isAbsolute(root)) throw new Error('Private paths must be absolute');
    await mkdir(root, { recursive: true, mode: 0o700 });
    const safeRoot = await realpath(root);
    const repo = await realpath(this.options.repoRoot ?? process.cwd());
    if (inside(safeRoot, repo) || inside(repo, safeRoot))
      throw new Error('Workspace overlaps the public repository');
    for (const entry of await readdir(safeRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
      const job = await this.options.queue.get(entry.name);
      if (
        !job ||
        !['completed', 'failed', 'cancelled'].includes(job.status) ||
        this.now() - job.updatedAt < 7 * 24 * 60 * 60_000
      )
        continue;
      await rm(join(safeRoot, entry.name), { recursive: true, force: true });
    }
  }

  private async process(job: Job, signal: AbortSignal): Promise<string> {
    const root = this.options.workspaceRoot ?? join(homedir(), '.jdcv', 'jobs');
    if (!isAbsolute(root) || !isAbsolute(job.payload.inputRef))
      throw new Error('Private paths must be absolute');
    await mkdir(root, { recursive: true, mode: 0o700 });
    const safeRoot = await realpath(root);
    const repo = await realpath(this.options.repoRoot ?? process.cwd());
    if (inside(safeRoot, repo) || inside(repo, safeRoot))
      throw new Error('Workspace overlaps the public repository');
    const input = await realpath(job.payload.inputRef);
    if (inside(input, repo))
      throw new Error('Input is inside the public repository');
    const workspace = join(safeRoot, job.id);
    await mkdir(workspace, { mode: 0o700 });
    if (!inside(await realpath(workspace), safeRoot))
      throw new Error('Job workspace escapes private root');
    const paths = {
      input,
      module: join(workspace, 'module.json'),
      interview: join(workspace, 'interview.json'),
      rubric: join(workspace, 'rubric.json'),
    };
    if (!this.options.moduleOnlyDryRun) {
      const cvSource =
        this.options.cvSource ?? process.env.JDCV_CV_SOURCE ?? 'docx';
      if (cvSource !== 'docx' && cvSource !== 'portfolio')
        throw new PrivateCvError('CV_SOURCE_CONFIG');
      this.options.log?.({
        env: 't3-lil.parker',
        jobId: job.id,
        cvSource,
      });
      const proposal = await createCvProposal({
        source: cvSource,
        portfolioApiUrl:
          this.options.portfolioApiUrl ?? process.env.JDCV_PORTFOLIO_API_URL,
        portfolioLocale:
          this.options.portfolioLocale ??
          (process.env.JDCV_PORTFOLIO_LOCALE as 'en' | 'vi' | undefined),
        portfolioFetch: this.options.portfolioFetch,
        directory:
          this.options.privateCvDirectory ?? process.env.JDCV_PRIVATE_CV_DIR,
        repoRoot: repo,
        jdPath: input,
        workspace,
        cvVersionId: job.id,
        signal,
        relay: async (instructions, output, relaySignal) => {
          const promptFile = join(workspace, 'cv-generator-start.md');
          await writeFile(
            promptFile,
            'Prepare an owner CV proposal. Await instructions by relay.',
            { mode: 0o600 },
          );
          const thread = await this.options.runner.start(
            'Generator',
            promptFile,
            workspace,
            relaySignal,
          );
          if (!(await this.admission(true, false, relaySignal)))
            throw new Error('Mac load prevents a CV turn');
          await this.options.runner.send(thread, instructions, relaySignal);
          const observed = await this.options.runner.show(thread, relaySignal);
          if (observed.id !== thread.id)
            throw new Error('Thread identity changed');
          this.options.log?.({
            env: 't3-lil.parker',
            jobId: job.id,
            role: 'Generator',
            threadId: observed.id,
            provider: observed.provider,
            model: observed.model,
            switch:
              observed.provider !== thread.provider ||
              observed.model !== thread.model,
          });
          await realpath(output);
        },
      });
      await writeFile(
        join(workspace, 'cv-proposal.json'),
        JSON.stringify(proposal),
        { mode: 0o600 },
      );
    }
    const threads = new Map<Role, Thread>();
    const roles: Role[] = ['Generator', 'Interviewer', 'Examiner'];
    for (let revision = 0; revision <= 2; revision++) {
      for (const role of roles) {
        if (signal.aborted || this.now() >= job.deadlineAt)
          throw new Error('Job timed out');
        const existing = threads.get(role);
        if (!(await this.admission(Boolean(existing), true, signal)))
          throw new Error('Mac load prevents starting a thread');
        if (signal.aborted) throw new Error('Job timed out');
        const instructions = this.options.prompts.build(role, revision, paths);
        if (Buffer.byteLength(instructions, 'utf8') > LIMIT_BYTES)
          throw new Error('Turn exceeds 6144 bytes');
        let thread = existing;
        if (!thread) {
          const promptFile = join(workspace, `${role.toLowerCase()}-start.md`);
          await writeFile(
            promptFile,
            `Prepare the ${role} thread for job ${job.id}. Await instructions by relay.`,
            { mode: 0o600 },
          );
          thread = await this.options.runner.start(
            role,
            promptFile,
            workspace,
            signal,
          );
          if ([...threads.values()].some((item) => item.id === thread!.id))
            throw new Error('Threads must be distinct');
          threads.set(role, thread);
        }
        if (!(await this.admission(true, false, signal)))
          throw new Error('Mac load prevents a turn');
        await this.options.runner.send(thread, instructions, signal);
        const observed = await this.options.runner.show(thread, signal);
        if (observed.id !== thread.id)
          throw new Error('Thread identity changed');
        this.options.log?.({
          env: 't3-lil.parker',
          jobId: job.id,
          role,
          threadId: thread.id,
          provider: observed.provider,
          model: observed.model,
          switch:
            observed.provider !== thread.provider ||
            observed.model !== thread.model,
        });
        threads.set(role, observed);
      }
      const module = moduleV2Schema.parse(
        JSON.parse(await readFile(paths.module, 'utf8')),
      );
      const interview = JSON.parse(await readFile(paths.interview, 'utf8')) as {
        covered?: unknown;
        defended?: unknown;
      };
      const rubric = JSON.parse(await readFile(paths.rubric, 'utf8')) as Rubric;
      const requirements = module.requirements.map((item) => item.id);
      const embellishments = module.entries.flatMap(
        (item) => item.embellishmentRefs?.map((ref) => ref.id) ?? [],
      );
      const covers = (observed: unknown, expected: string[]) =>
        Array.isArray(observed) &&
        observed.length === expected.length &&
        expected.every((id) => observed.includes(id));
      if (
        covers(interview.covered, requirements) &&
        covers(interview.defended, embellishments) &&
        passesRubric(module, rubric)
      ) {
        let gatedModule = module;
        if (this.options.qualityGate) {
          const result = await this.options.qualityGate.run(module, job);
          gatedModule = moduleV2Schema.parse({
            ...module,
            qualityGate: result,
          });
          await writeFile(paths.module, JSON.stringify(gatedModule), {
            mode: 0o600,
          });
          if (!result.passed || result.failures.length)
            throw new RubricFailure();
        }
        const topicsByEntry = new Map<string, string[]>();
        const matcher = this.options.kbMatcher ?? {
          extract: async (requirement: string) => [requirement],
          judge: async () => ({ match: 'none' as const }),
          generate: async (topic: string) =>
            `The ${topic} topic explains a general concept. For example, a fictional page can demonstrate it.`,
        };
        let entryIndex = 0;
        const trackedMatcher: Matcher = {
          judge: (topic, candidates) => matcher.judge(topic, candidates),
          generate: (topic, existing) => matcher.generate(topic, existing),
          extract: async (requirement) => {
            const topics = await matcher.extract(requirement);
            topicsByEntry.set(
              module.entries[entryIndex++]!.id,
              topics.map(normalizeTopic),
            );
            return topics;
          },
        };
        let enriched: ModuleV2 | null = null;
        try {
          const planStart =
            this.kbClient instanceof DryRunKbContentClient
              ? this.kbClient.plan.length
              : 0;
          const result = await autofill(
            {
              jobId: job.id,
              moduleId: job.id,
              requirements: module.entries.map(
                (entry) =>
                  module.requirements.find(
                    (item) => item.id === entry.jdRequirement,
                  )!.title.en,
              ),
              companyNames: [],
              jdSentences: [],
              privateNames: [],
            },
            this.kbClient,
            trackedMatcher,
            this.options.kbLock ?? { run: (operation) => operation() },
          );
          enriched = moduleV2Schema.parse({
            ...gatedModule,
            entries: module.entries.map((entry) => {
              const sources = topicsByEntry.get(entry.id) ?? [];
              const refs = result.links
                .filter((link) => sources.includes(link.sourceTopic ?? ''))
                .map((link) => ({
                  slug: link.kbSlug,
                  sectionId: link.sectionId,
                  state: link.state,
                }));
              return {
                ...entry,
                ...(refs.length
                  ? { kbRefs: [...(entry.kbRefs ?? []), ...refs] }
                  : {}),
              };
            }),
          });
          if (this.kbClient instanceof DryRunKbContentClient) {
            await writeFile(
              join(workspace, 'kb-autofill-plan.json'),
              JSON.stringify({
                proposals: this.kbClient.plan.slice(planStart),
                queued: result.queued,
              }),
              { mode: 0o600 },
            );
          }
        } catch {
          await writeFile(
            join(workspace, 'kb-autofill-result.json'),
            JSON.stringify({ reason: 'KB_AUTOFILL_FAILED' }),
            { mode: 0o600 },
          );
        }
        if (enriched)
          await writeFile(paths.module, JSON.stringify(enriched), {
            mode: 0o600,
          });
        return this.options.moduleOnlyDryRun
          ? paths.module
          : join(workspace, 'cv-proposal.json');
      }
    }
    throw new RubricFailure();
  }
}

class RubricFailure extends Error {}

export {
  readDeliveryManifest,
  writeDeliveryManifest,
} from './delivery-manifest.js';
