import { describe, expect, it, vi } from 'vitest';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planPhase1Removal } from './git-plan.js';

describe('Phase 1 git plan', () => {
  it('AC10 proposes only the target file and index entry, then becomes a no-op', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jdcv-git-plan-'));
    try {
      await mkdir(join(root, 'modules'));
      const indexPath = join(root, 'index.json');
      const other = join(root, 'modules', 'sample-two.json');
      await writeFile(join(root, 'modules', 'sample-one.json'), '{}');
      await writeFile(other, '{}');
      await writeFile(
        indexPath,
        JSON.stringify({
          modules: [
            { slug: 'sample-one', path: 'modules/sample-one.json', version: 2 },
            { slug: 'sample-two', path: 'modules/sample-two.json', version: 2 },
          ],
        }),
      );
      const propose = vi.fn(
        async (change: {
          branch: string;
          title: string;
          deletePath: string | null;
          index: string;
        }) => {
          if (change.deletePath) await unlink(join(root, change.deletePath));
          await writeFile(indexPath, change.index);
        },
      );
      const client = {
        readIndex: () => readFile(indexPath, 'utf8'),
        moduleExists: async (path: string) =>
          readFile(join(root, path)).then(
            () => true,
            () => false,
          ),
        propose,
      };
      expect(await planPhase1Removal('sample-one', client)).toBe(true);
      expect(propose).toHaveBeenCalledWith(
        expect.objectContaining({
          branch: 'chore/module-delete-sample-one',
          title: 'chore: remove archived module sample-one',
          deletePath: 'modules/sample-one.json',
        }),
      );
      expect(JSON.parse(await readFile(indexPath, 'utf8'))).toEqual({
        modules: [
          { slug: 'sample-two', path: 'modules/sample-two.json', version: 2 },
        ],
      });
      expect(await readFile(other, 'utf8')).toBe('{}');
      expect(await planPhase1Removal('sample-one', client)).toBe(false);
      expect(propose).toHaveBeenCalledTimes(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
