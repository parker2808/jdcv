import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { z } from 'zod';
import {
  deliveryManifestSchema,
  moduleIndexSchema,
  moduleV1Schema,
  moduleV2Schema,
} from '../src/index.js';

const directory = fileURLToPath(new URL('../schemas/', import.meta.url));
const schemas = {
  'module-v1.schema.json': moduleV1Schema,
  'module-v2.schema.json': moduleV2Schema,
  'module-index.schema.json': moduleIndexSchema,
  'delivery-manifest-v1.schema.json': deliveryManifestSchema,
};

for (const [name, schema] of Object.entries(schemas)) {
  const document = z.toJSONSchema(schema, { target: 'draft-07' });
  document['x-jdcv-integrity'] =
    name === 'delivery-manifest-v1.schema.json'
      ? 'delivery-manifest'
      : name === 'module-index.schema.json'
        ? 'index'
        : 'module';
  const output = await prettier.format(JSON.stringify(document), {
    parser: 'json',
  });
  const path = `${directory}${name}`;
  if (process.argv.includes('--check')) {
    if ((await readFile(path, 'utf8').catch(() => '')) !== output) {
      throw new Error(
        `${name} is stale. Run pnpm --filter @jdcv/contracts schema:generate.`,
      );
    }
  } else {
    await writeFile(path, output);
  }
}
