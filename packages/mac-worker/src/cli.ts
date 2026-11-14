import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { FileJobQueue } from '@jdcv/queue';
import {
  MacWorker,
  type PromptBuilder,
  type RelayRunner,
  type Role,
  type Thread,
} from './index.js';
import { SysctlLoad, T3Relay } from './adapters.js';

const help = `Usage: pnpm --filter @jdcv/mac-worker start -- [--dry-run] [--once]

Set JDCV_OWNER_ID to the owner ID, JDCV_QUEUE_DIR to an absolute private queue
directory, JDCV_JOB_DIR to an absolute private workspace directory, and
JDCV_T3_REPO to a private local Git repository for live T3 threads.
--dry-run uses a fake module and fake rubric; it never calls a model.
--once handles one available job; without it the worker polls every 30 seconds.
Input references must name private files. Only owner jobs on the mac route run.
For example, enqueue a fake Alex Example JD with maxAttempts: 1, then use
--dry-run --once to exercise the queue without starting T3 threads.`;

const prompts: PromptBuilder = {
  build(role, revision, paths) {
    return `For the ${role} stage (revision ${revision}), read the private input at ${paths.input}. Read prior stage files if present: ${paths.module}, ${paths.interview}, ${paths.rubric}. Write ${role === 'Generator' ? paths.module : role === 'Interviewer' ? paths.interview : paths.rubric} as JSON. Ground every claim in the input; never invent experience. Interviewer: probe every mandatory requirement and every CV embellishment, then write covered and defended arrays of IDs. Examiner: score average, mandatoryCoverage, embellishmentDefenses (one score per embellishment), criticalFindings and readability by entry ID. Do not echo input text. Require human review of generated results.`;
  },
};

class DryRunner implements RelayRunner {
  async start(role: Role): Promise<Thread> {
    return { id: `fake-${role}`, provider: 'mock', model: 'none' };
  }
  async send(thread: Thread, instructions: string): Promise<void> {
    const destination = instructions.match(/Write ([^ ]+) as JSON/)?.[1];
    if (!destination) throw new Error('Missing fake destination');
    if (thread.id === 'fake-Generator') {
      await writeFile(
        destination,
        JSON.stringify({
          version: 2,
          requirements: [
            {
              id: 'req-frontend',
              title: { en: 'Build a sample page', vi: 'Làm trang mẫu' },
            },
          ],
          entries: [
            {
              id: 'example-entry',
              section: 'interview',
              jdRequirement: 'req-frontend',
              tags: ['frontend'],
              title: { en: 'How?', vi: 'Làm sao?' },
              shortAnswer: {
                en: 'Test a small page.',
                vi: 'Thử một trang nhỏ.',
              },
              keyPoints: [],
              detail: {
                en: 'For example, test a form.',
                vi: 'Ví dụ, thử một biểu mẫu.',
              },
            },
          ],
        }),
        { mode: 0o600 },
      );
    } else if (thread.id === 'fake-Interviewer') {
      await writeFile(
        destination,
        JSON.stringify({ covered: ['req-frontend'], defended: [] }),
        { mode: 0o600 },
      );
    } else {
      await writeFile(
        destination,
        JSON.stringify({
          average: 4,
          mandatoryCoverage: 1,
          embellishmentDefenses: [],
          criticalFindings: 0,
          readability: { 'example-entry': 4 },
        }),
        { mode: 0o600 },
      );
    }
  }
  async show(thread: Thread): Promise<Thread> {
    return thread;
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(help);
    return;
  }
  if (
    process.argv
      .slice(2)
      .some((arg) => !['--', '--dry-run', '--once'].includes(arg))
  )
    throw new Error('Unknown option; use --help');
  const ownerId = process.env.JDCV_OWNER_ID;
  if (!ownerId) throw new Error('Set JDCV_OWNER_ID');
  const dry = process.argv.includes('--dry-run');
  const privateRepo = process.env.JDCV_T3_REPO;
  if (!dry && !privateRepo) throw new Error('Set JDCV_T3_REPO for live runs');
  const worker = new MacWorker({
    queue: new FileJobQueue(),
    runner: dry ? new DryRunner() : new T3Relay(privateRepo!),
    prompts,
    load: new SysctlLoad(),
    ownerId,
    workspaceRoot: process.env.JDCV_JOB_DIR,
    repoRoot: fileURLToPath(new URL('../../../', import.meta.url)),
    log: (event) => console.log(JSON.stringify(event)),
  });
  for (;;) {
    await worker.cleanup();
    const job = await worker.runOnce();
    if (job) console.log(`Job ${job.id}: ${job.status}`);
    if (process.argv.includes('--once')) break;
    await new Promise((done) => setTimeout(done, 30_000));
  }
}

void main().catch(() => {
  console.error('Worker failed; check private job status.');
  process.exitCode = 1;
});
