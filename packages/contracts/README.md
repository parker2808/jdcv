# Module contracts

`@jdcv/contracts` keeps old interview packs readable while giving new modules a shared, checked shape. For example, a fictional frontend question can keep its English and Vietnamese answers while adding a pending knowledge-base (KB) reference that the web view must not show as a live link.

## Help / usage

The owner-only `deliveryManifestSchema` and `DeliveryManifest` type define a separate version 1 handoff after all proposed CV lines are decided and both exports pass their gates. The generated schema is `@jdcv/contracts/schemas/delivery-manifest-v1`. For example, a fictional `example-job` manifest lists `approved.docx` and `approved.pdf` by relative file name, byte length, and SHA-256 digest. A consumer must also verify the decision-to-approval relationship and read private regular files without following links; JSON Schema cannot check file contents or filesystem links. See the [delivery manifest specification](../../docs/specs/delivery-manifest.md).

Import `moduleV1Schema`, `moduleV2Schema`, `moduleIndexSchema`, `convertModuleV1ToV2`, and `checkModuleLanguageParity` from `@jdcv/contracts`. The converter takes an unknown value, rejects invalid version 1 data with a field path, and returns a version 2 value. Calling it with a valid version 2 module returns the same data. It performs no file or network work.

Import `toContentModule` when a reviewed owner-only worker result needs the content document shape. Pass a `ModuleV2` and `ContentModuleMeta` containing reviewed bilingual labels, date, alias, tags, and lifecycle status. For example, `toContentModule(workerModule, reviewedMeta)` copies a pending knowledge-base reference without making it live, converts a CV-review reference to its ID, and rejects an entry with no real key point. It does not create the index or publish content. See the [field-by-field mapping](../../docs/specs/module-content-mapping.md).

```ts
import {
  convertModuleV1ToV2,
  checkModuleLanguageParity,
} from '@jdcv/contracts';

const module = convertModuleV1ToV2(input);
const missingTranslations = checkModuleLanguageParity(module);
```

A module has `version`, `requirements`, and `entries`. A requirement has an ID and a bilingual title. An entry has an ID, a section, an optional-by-value requirement ID (`""` when unrelated), tags, bilingual title, short answer and detail, and an array of bilingual key points. Version 2 adds optional `kbRefs` and `embellishmentRefs` arrays. A KB reference has a topic `slug`, `sectionId`, and `state` (`pending`, `live`, or `rejected`). A CV review reference has an `id`, `status` (`pending` or `approved`), and `defenseEntryId` pointing to an entry in the same module. It carries no CV text. A migrated entry receives empty arrays, not fabricated links. Neither archive dates nor job-description IDs are module-document fields in the version 2 specification; those belong to later storage records.

The committed JSON Schema documents are available through `@jdcv/contracts/schemas/v1`, `/v2`, and `/index`. Run `pnpm --filter @jdcv/contracts schema:generate` after a validator change; `pnpm schema:check` and the unit test reject stale files. For example, a non-TypeScript worker can load `schemas/module-v2.schema.json` and validate generated JSON before indexing it.

Standard JSON Schema cannot express uniqueness by one property or a link to an ID elsewhere in the document. Each schema therefore includes `x-jdcv-integrity`: `module` requires unique requirement and entry IDs, a valid nonempty `jdRequirement`, and an existing `defenseEntryId`; `index` requires unique slugs. A JSON Schema validator must register this extension, as the Ajv test does, to enforce those relationships. Ignoring an unknown extension checks structure only and must not be used to publish a module. The KB target itself must be verified against an authorized KB index before changing `pending` to `live`; no module document can verify an external target by itself.
