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
