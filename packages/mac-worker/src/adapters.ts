import { execFile as execFileCallback, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type {
  GateLock,
  LoadReader,
  RelayRunner,
  Role,
  Thread,
} from './index.js';

const execFile = promisify(execFileCallback);

export class SysctlLoad implements LoadReader {
  async read(): Promise<number> {
    const { stdout } = await execFile('sysctl', ['-n', 'vm.loadavg']);
    const match = stdout.match(/\{\s*([\d.]+)/);
    if (!match) throw new Error('Cannot read Mac load');
    return Number(match[1]);
  }
}

export class SharedGateLock implements GateLock {
  constructor(
    private readonly lockPath = join(
      homedir(),
      '.t3',
      'locks',
      'lilp-e2e.lock',
    ),
    private readonly load: LoadReader = new SysctlLoad(),
    private readonly pause: (ms: number) => Promise<void> = (ms) =>
      new Promise((done) => setTimeout(done, ms)),
  ) {}

  async command(command: string, args: string[] = []): Promise<void> {
    for (;;) {
      const load = await this.load.read();
      if (!Number.isFinite(load) || load < 0)
        throw new Error('Invalid Mac load');
      if (load <= 40) {
        if (load >= 25)
          throw new Error('Heavy gate is not admitted at this load');
        break;
      }
      await this.pause(120_000);
    }
    await mkdir(dirname(this.lockPath), { recursive: true });
    const tool = await execFile('which', ['flock'])
      .then(() => 'flock')
      .catch(() => 'lockf');
    await execFile(tool, [this.lockPath, command, ...args]);
  }
}

function run(
  command: string,
  args: string[],
  input: string,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        T3_ENV: 'parker',
        T3CODE_HOME: join(homedir(), '.t3'),
      },
      signal,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > 1_000_000) child.kill();
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > 1_000_000) child.kill();
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`T3 command exited ${code}`)),
    );
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export class T3Relay implements RelayRunner {
  constructor(private readonly privateRepo: string) {
    if (
      !privateRepo.startsWith('/') ||
      !privateRepo.startsWith(homedir() + '/')
    )
      throw new Error('Private T3 repository must be under home');
  }

  async start(
    role: Role,
    promptFile: string,
    workspace: string,
    signal: AbortSignal,
  ): Promise<Thread> {
    const jobId = workspace.split('/').at(-1)!;
    const stdout = await run(
      join(homedir(), 'ai-tools', 't3-run.sh'),
      [
        this.privateRepo,
        `jdcv-${jobId}-${role.toLowerCase()}`,
        `JDCV ${role} ${jobId}`,
        promptFile,
      ],
      '',
      signal,
    );
    const done = [
      ...stdout.matchAll(/EVENT DONE (\S+) (\S+) thread=([^\s]+)/g),
    ].at(-1);
    if (!done) throw new Error('Runner did not finish a thread');
    return { id: done[3], provider: done[1], model: done[2] };
  }

  async send(
    thread: Thread,
    instructions: string,
    signal: AbortSignal,
  ): Promise<void> {
    await run(
      join(homedir(), '.t3', 'bin', 't3'),
      ['thread', 'send', thread.id, '-', '--wait', '--json'],
      instructions,
      signal,
    );
  }

  async show(thread: Thread, signal: AbortSignal): Promise<Thread> {
    const stdout = await run(
      join(homedir(), '.t3', 'bin', 't3'),
      ['thread', 'show', thread.id, '--json', '--messages', '0'],
      '',
      signal,
    );
    const data = JSON.parse(stdout) as {
      thread?: { provider?: string; model?: string };
    };
    return {
      ...thread,
      provider: data.thread?.provider ?? thread.provider,
      model: data.thread?.model ?? thread.model,
    };
  }
}
