import { z } from 'zod';

const identifier = z.string().min(1);
const localizedText = z.string().min(1).regex(/\S/);
const localized = z.strictObject({ en: localizedText, vi: localizedText });
const section = z.enum([
  'jd',
  'concepts',
  'interview',
  'pitch',
  'rescue',
  'ask',
  'cheat',
]);

const requirement = z.strictObject({ id: identifier, title: localized });

const baseEntry = z.strictObject({
  id: identifier,
  section,
  jdRequirement: z.string(),
  tags: z.array(z.string()),
  title: localized,
  shortAnswer: localized,
  keyPoints: z.array(localized),
  detail: localized,
});

export const kbRefSchema = z.strictObject({
  slug: identifier,
  sectionId: identifier,
  state: z.enum(['pending', 'live', 'rejected']),
});

export const embellishmentRefSchema = z.strictObject({
  id: identifier,
  status: z.enum(['pending', 'approved']),
  defenseEntryId: identifier,
});

export const qualityGateResultSchema = z.strictObject({
  passed: z.boolean(),
  failures: z.array(z.strictObject({ field: z.string(), reason: z.string() })),
});
export type QualityGateResult = z.infer<typeof qualityGateResultSchema>;

function checkLinks(
  module: {
    requirements: { id: string }[];
    entries: {
      id: string;
      jdRequirement: string;
      embellishmentRefs?: { defenseEntryId: string }[];
    }[];
  },
  context: z.RefinementCtx,
): void {
  const requirements = new Set<string>();
  for (const [index, requirement] of module.requirements.entries()) {
    if (requirements.has(requirement.id)) {
      context.addIssue({
        code: 'custom',
        path: ['requirements', index, 'id'],
        message: 'Duplicate requirement ID',
      });
    }
    requirements.add(requirement.id);
  }

  const entries = new Set<string>();
  for (const [index, entry] of module.entries.entries()) {
    if (entries.has(entry.id)) {
      context.addIssue({
        code: 'custom',
        path: ['entries', index, 'id'],
        message: 'Duplicate entry ID',
      });
    }
    entries.add(entry.id);
    if (entry.jdRequirement && !requirements.has(entry.jdRequirement)) {
      context.addIssue({
        code: 'custom',
        path: ['entries', index, 'jdRequirement'],
        message: 'Unknown requirement ID',
      });
    }
  }

  for (const [index, entry] of module.entries.entries()) {
    for (const [refIndex, ref] of (entry.embellishmentRefs ?? []).entries()) {
      if (!entries.has(ref.defenseEntryId)) {
        context.addIssue({
          code: 'custom',
          path: [
            'entries',
            index,
            'embellishmentRefs',
            refIndex,
            'defenseEntryId',
          ],
          message: 'Unknown defense entry ID',
        });
      }
    }
  }
}

export const moduleV1Schema = z
  .strictObject({
    version: z.literal(1),
    requirements: z.array(requirement),
    entries: z.array(baseEntry),
  })
  .superRefine(checkLinks);

export const moduleV2Schema = z
  .strictObject({
    version: z.literal(2),
    requirements: z.array(requirement),
    entries: z.array(
      baseEntry.extend({
        kbRefs: z.array(kbRefSchema).optional(),
        embellishmentRefs: z.array(embellishmentRefSchema).optional(),
      }),
    ),
    qualityGate: qualityGateResultSchema.optional(),
  })
  .superRefine(checkLinks);

const moduleIndexEntry = z.strictObject({
  slug: identifier,
  path: identifier,
  version: z.union([z.literal(1), z.literal(2)]),
});

export const moduleIndexSchema = z
  .strictObject({
    modules: z.array(moduleIndexEntry),
  })
  .superRefine((index, context) => {
    const slugs = new Set<string>();
    for (const [position, module] of index.modules.entries()) {
      if (slugs.has(module.slug)) {
        context.addIssue({
          code: 'custom',
          path: ['modules', position, 'slug'],
          message: 'Duplicate module slug',
        });
      }
      slugs.add(module.slug);
    }
  });

export type ModuleV1 = z.infer<typeof moduleV1Schema>;
export type ModuleV2 = z.infer<typeof moduleV2Schema>;
export type ModuleIndex = z.infer<typeof moduleIndexSchema>;

const contentDate = z.iso.date();
const contentTimestamp = z.iso.datetime({ offset: true });
const contentMetadata = z
  .strictObject({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    organizationAlias: localizedText,
    role: localized,
    level: localized,
    date: contentDate,
    tags: z.array(z.string()),
    status: z.enum(['active', 'archived']),
    archivedAt: contentTimestamp.optional(),
    purgeAfter: contentTimestamp.optional(),
    autoArchive: z.boolean().optional(),
    lastOpenedAt: contentTimestamp.optional(),
    title: localized,
    summary: localized,
    testScore: z.number().min(0).max(100).optional(),
    fixture: z.boolean().optional(),
  })
  .superRefine((meta, context) => {
    if (meta.status === 'active' && (meta.archivedAt || meta.purgeAfter)) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Active modules cannot have archive timestamps',
      });
    }
    if (meta.status === 'archived') {
      if (!meta.archivedAt || !meta.purgeAfter) {
        context.addIssue({
          code: 'custom',
          path: ['archivedAt', 'purgeAfter'],
          message: 'Archived modules require both timestamps',
        });
      } else if (
        Date.parse(meta.purgeAfter) - Date.parse(meta.archivedAt) !==
        7 * 86400000
      ) {
        context.addIssue({
          code: 'custom',
          path: ['purgeAfter'],
          message: 'Purge must be exactly seven days after archive',
        });
      }
    }
  });

export type ContentModuleMeta = z.input<typeof contentMetadata>;
export type ContentModule = z.output<typeof contentMetadata> & {
  version: 2;
  requirements: ModuleV2['requirements'];
  entries: (Omit<ModuleV2['entries'][number], 'embellishmentRefs'> & {
    embellishmentRefs?: string[];
  })[];
};

export function toContentModule(
  module: ModuleV2,
  meta: ContentModuleMeta,
): ContentModule {
  const parsedModule = moduleV2Schema.parse(module);
  const parsedMeta = contentMetadata.safeParse(meta);
  if (!parsedMeta.success) {
    throw new Error(
      `Invalid content metadata: ${z.prettifyError(parsedMeta.error)}`,
    );
  }
  const requirementIds = new Set(
    parsedModule.requirements.map((item) => item.id),
  );
  const entries = parsedModule.entries.map((entry, index) => {
    if (!requirementIds.has(entry.jdRequirement)) {
      throw new Error(
        `entries[${index}].jdRequirement: required existing requirement ID`,
      );
    }
    if (!entry.keyPoints.length) {
      throw new Error(
        `entries[${index}].keyPoints: at least one bilingual key point required`,
      );
    }
    return {
      id: entry.id,
      section: entry.section,
      jdRequirement: entry.jdRequirement,
      tags: [...entry.tags],
      title: { ...entry.title },
      shortAnswer: { ...entry.shortAnswer },
      keyPoints: entry.keyPoints.map((point) => ({ ...point })),
      detail: { ...entry.detail },
      ...(entry.kbRefs === undefined
        ? {}
        : {
            kbRefs: entry.kbRefs.map((ref) => ({
              slug: ref.slug,
              sectionId: ref.sectionId,
              state: ref.state,
            })),
          }),
      ...(entry.embellishmentRefs === undefined
        ? {}
        : { embellishmentRefs: entry.embellishmentRefs.map((ref) => ref.id) }),
    };
  });
  return {
    version: parsedModule.version,
    slug: parsedMeta.data.slug,
    organizationAlias: parsedMeta.data.organizationAlias,
    role: { ...parsedMeta.data.role },
    level: { ...parsedMeta.data.level },
    date: parsedMeta.data.date,
    tags: [...parsedMeta.data.tags],
    status: parsedMeta.data.status,
    ...(parsedMeta.data.archivedAt === undefined
      ? {}
      : { archivedAt: parsedMeta.data.archivedAt }),
    ...(parsedMeta.data.purgeAfter === undefined
      ? {}
      : { purgeAfter: parsedMeta.data.purgeAfter }),
    ...(parsedMeta.data.autoArchive === undefined
      ? {}
      : { autoArchive: parsedMeta.data.autoArchive }),
    ...(parsedMeta.data.lastOpenedAt === undefined
      ? {}
      : { lastOpenedAt: parsedMeta.data.lastOpenedAt }),
    title: { ...parsedMeta.data.title },
    summary: { ...parsedMeta.data.summary },
    ...(parsedMeta.data.testScore === undefined
      ? {}
      : { testScore: parsedMeta.data.testScore }),
    ...(parsedMeta.data.fixture === undefined
      ? {}
      : { fixture: parsedMeta.data.fixture }),
    requirements: parsedModule.requirements.map((item) => ({
      id: item.id,
      title: { ...item.title },
    })),
    entries,
  };
}

export function convertModuleV1ToV2(input: unknown): ModuleV2 {
  if (
    typeof input === 'object' &&
    input !== null &&
    'version' in input &&
    input.version === 2
  ) {
    return moduleV2Schema.parse(input);
  }
  const result = moduleV1Schema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid v1 module: ${z.prettifyError(result.error)}`);
  }
  return moduleV2Schema.parse({
    ...result.data,
    version: 2,
    entries: result.data.entries.map((entry) => ({
      ...entry,
      kbRefs: [],
      embellishmentRefs: [],
    })),
  });
}

export type ParityIssue = { path: string; missing: 'en' | 'vi' };

export function checkModuleLanguageParity(input: unknown): ParityIssue[] {
  const issues: ParityIssue[] = [];
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
    } else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if ('en' in record || 'vi' in record) {
        for (const language of ['en', 'vi'] as const) {
          if (
            typeof record[language] !== 'string' ||
            !record[language].trim()
          ) {
            issues.push({ path: `${path}.${language}`, missing: language });
          }
        }
      } else {
        for (const [key, item] of Object.entries(record))
          visit(item, path ? `${path}.${key}` : key);
      }
    }
  };
  visit(input, '');
  return issues;
}
