#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import {
  createModuleLifecycle,
  type Dependencies,
  type Result,
} from './index.js';

const usage =
  'Usage: pnpm --filter @jdcv/module-lifecycle cli archive|restore|purge|keep|status --slug <slug> --actor <id>. Set JDCV_MODULE_ADAPTER to a trusted local adapter module exporting dependencies and workspaceId. Exit 0: success; 2: refusal or invalid input; 1: incomplete purge or adapter failure.';

export async function runCli(
  args: string[],
  load: () => Promise<Dependencies & { workspaceId: string }>,
): Promise<{ output: string; exitCode: number }> {
  const [command, ...flags] = args;
  if (command === '--help' || command === 'help')
    return {
      output: JSON.stringify({
        ok: true,
        state: null,
        code: 'OK',
        message: usage,
      }),
      exitCode: 0,
    };
  const slugIndex = flags.indexOf('--slug');
  const actorIndex = flags.indexOf('--actor');
  if (
    !['archive', 'restore', 'purge', 'keep', 'status'].includes(
      command ?? '',
    ) ||
    slugIndex < 0 ||
    actorIndex < 0 ||
    !flags[slugIndex + 1] ||
    !flags[actorIndex + 1]
  ) {
    return {
      output: JSON.stringify({
        ok: false,
        state: null,
        code: 'INVALID_INPUT',
        message: usage,
      }),
      exitCode: 2,
    };
  }
  try {
    const deps = await load();
    const service = createModuleLifecycle(deps);
    const context = {
      actorId: flags[actorIndex + 1],
      workspaceId: deps.workspaceId,
    };
    const result: Result = await service[
      command as 'archive' | 'restore' | 'purge' | 'keep' | 'status'
    ](context, flags[slugIndex + 1]);
    const { ok, state, code, message } = result;
    return {
      output: JSON.stringify({ ok, state, code, message }),
      exitCode: ok ? 0 : code === 'PURGE_INCOMPLETE' ? 1 : 2,
    };
  } catch {
    return {
      output: JSON.stringify({
        ok: false,
        state: null,
        code: 'ADAPTER_FAILURE',
        message: 'Trusted adapter unavailable',
      }),
      exitCode: 1,
    };
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const response = await runCli(process.argv.slice(2), async () => {
    const adapterPath = process.env.JDCV_MODULE_ADAPTER;
    if (!adapterPath || !adapterPath.startsWith('/'))
      throw new Error('Adapter unavailable');
    const adapter: unknown = await import(pathToFileURL(adapterPath).href);
    if (!adapter || typeof adapter !== 'object' || !('dependencies' in adapter))
      throw new Error('Adapter unavailable');
    return (adapter as { dependencies: Dependencies & { workspaceId: string } })
      .dependencies;
  });
  process.stdout.write(response.output + '\n');
  process.exitCode = response.exitCode;
}
