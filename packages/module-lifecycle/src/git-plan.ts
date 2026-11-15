import { moduleIndexSchema } from '@jdcv/contracts';

export interface GitPlanClient {
  readIndex(): Promise<string>;
  moduleExists(path: string): Promise<boolean>;
  propose(change: {
    branch: string;
    title: string;
    deletePath: string | null;
    index: string;
  }): Promise<void>;
}

export async function planPhase1Removal(
  slug: string,
  client: GitPlanClient,
): Promise<boolean> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug))
    throw new Error('Invalid module slug');
  const original = await client.readIndex();
  const parsed: unknown = JSON.parse(original);
  const index = moduleIndexSchema.parse(parsed);
  const path = `modules/${slug}.json`;
  const exists = await client.moduleExists(path);
  const entries = index.modules.filter((entry) => entry.slug !== slug);
  if (!exists && entries.length === index.modules.length) return false;
  await client.propose({
    branch: `chore/module-delete-${slug}`,
    title: `chore: remove archived module ${slug}`,
    deletePath: exists ? path : null,
    index: JSON.stringify({ ...index, modules: entries }, null, 2) + '\n',
  });
  return true;
}
