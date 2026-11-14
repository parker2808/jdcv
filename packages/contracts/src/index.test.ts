import Ajv from 'ajv';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import v1 from './fixtures/fde-v1.json';
import v2 from './fixtures/fde-v2.json';
import indexSchema from '../schemas/module-index.schema.json';
import v1JsonSchema from '../schemas/module-v1.schema.json';
import v2JsonSchema from '../schemas/module-v2.schema.json';
import {
  checkModuleLanguageParity,
  convertModuleV1ToV2,
  moduleIndexSchema,
  moduleV1Schema,
  moduleV2Schema,
} from './index.js';

const ajv = new Ajv({ strict: false });
type IntegrityModule = {
  requirements: { id: string }[];
  entries: {
    id: string;
    jdRequirement: string;
    embellishmentRefs?: { defenseEntryId: string }[];
  }[];
};
const unique = (identifiers: string[]) =>
  new Set(identifiers).size === identifiers.length;
ajv.addKeyword({
  keyword: 'x-jdcv-integrity',
  schemaType: 'string',
  validate: (kind: string, value: unknown) => {
    if (kind === 'index') {
      const index = value as { modules?: { slug: string }[] };
      return (
        !index.modules || unique(index.modules.map((module) => module.slug))
      );
    }
    const module = value as Partial<IntegrityModule>;
    if (!module.requirements || !module.entries) return true;
    const requirementIds = module.requirements.map(
      (requirement) => requirement.id,
    );
    const entryIds = module.entries.map((entry) => entry.id);
    return (
      unique(requirementIds) &&
      unique(entryIds) &&
      module.entries.every(
        (entry) =>
          (!entry.jdRequirement ||
            requirementIds.includes(entry.jdRequirement)) &&
          (entry.embellishmentRefs ?? []).every((ref) =>
            entryIds.includes(ref.defenseEntryId),
          ),
      )
    );
  },
});
const validateV1 = ajv.compile(v1JsonSchema);
const validateV2 = ajv.compile(v2JsonSchema);
const validateIndex = ajv.compile(indexSchema);

const copy = <T>(value: T): T => structuredClone(value);

describe('module contracts', () => {
  it('preserves every v1 field, its order, and both languages', () => {
    const input = copy(v1);
    expect(moduleV1Schema.safeParse(input).success).toBe(true);
    expect(validateV1(input)).toBe(true);
    expect(convertModuleV1ToV2(input)).toEqual(v2);
    expect(input).toEqual(v1);
    expect(
      convertModuleV1ToV2(v1).entries.map((entry) =>
        Object.fromEntries(
          Object.entries(entry).filter(
            ([key]) => !['kbRefs', 'embellishmentRefs'].includes(key),
          ),
        ),
      ),
    ).toEqual(v1.entries);
  });

  it('converts deterministically and accepts v2 without changing it', () => {
    expect(convertModuleV1ToV2(v1)).toEqual(convertModuleV1ToV2(v1));
    expect(convertModuleV1ToV2(v2)).toEqual(v2);
    expect(moduleV2Schema.safeParse(v2).success).toBe(true);
    expect(validateV2(v2)).toBe(true);
    expect(checkModuleLanguageParity(v2)).toEqual([]);
  });

  it('reports every unpaired or blank translation with its exact path', () => {
    const input = copy(v2);
    input.requirements[0].title.vi = '  ';
    Reflect.deleteProperty(input.entries[0].shortAnswer, 'en');
    input.entries[0].keyPoints[0].vi = '';
    expect(checkModuleLanguageParity(input)).toEqual([
      { path: 'requirements[0].title.vi', missing: 'vi' },
      { path: 'entries[0].shortAnswer.en', missing: 'en' },
      { path: 'entries[0].keyPoints[0].vi', missing: 'vi' },
    ]);
  });

  it('rejects the same invalid fixtures with both validators', () => {
    const missing = copy(v2);
    Reflect.deleteProperty(missing.entries[0].title, 'vi');
    const duplicate = copy(v2);
    duplicate.entries.push({
      ...duplicate.entries[0],
      title: { en: 'Other', vi: 'Khác' },
    });
    const malformed = copy(v2);
    Object.assign(malformed.entries[0], {
      kbRefs: [{ slug: '', sectionId: 'focus', state: 'live' }],
    });
    const dangling = copy(v2);
    dangling.entries[0].jdRequirement = 'missing';
    const defense = copy(v2);
    Object.assign(defense.entries[0], {
      embellishmentRefs: [
        { id: 'review-1', status: 'approved', defenseEntryId: 'missing' },
      ],
    });
    for (const input of [missing, duplicate, malformed, dangling, defense]) {
      expect(moduleV2Schema.safeParse(input).success).toBe(false);
      expect(validateV2(input)).toBe(false);
    }
  });

  it('gives a useful error on invalid v1', () => {
    const invalid = copy(v1);
    invalid.entries[0].jdRequirement = 'unknown';
    expect(() => convertModuleV1ToV2(invalid)).toThrow(
      /Invalid v1 module:.*Unknown requirement ID/s,
    );
  });

  it('accepts old and new modules together in an index', () => {
    const index = {
      modules: [
        { slug: 'fde', path: 'fde/', version: 1 },
        { slug: 'sample', path: 'modules/sample.json', version: 2 },
      ],
    };
    expect(moduleIndexSchema.safeParse(index).success).toBe(true);
    expect(validateIndex(index)).toBe(true);
    expect(moduleV1Schema.safeParse(v1).success).toBe(true);
    expect(moduleV2Schema.safeParse(v2).success).toBe(true);
    const invalid = { modules: [index.modules[0], index.modules[0]] };
    expect(moduleIndexSchema.safeParse(invalid).success).toBe(false);
    expect(validateIndex(invalid)).toBe(false);
  });

  it('keeps committed JSON Schema in sync with the source validators', () => {
    for (const [schema, committed] of [
      [moduleV1Schema, v1JsonSchema],
      [moduleV2Schema, v2JsonSchema],
      [moduleIndexSchema, indexSchema],
    ] as const) {
      const generated = z.toJSONSchema(schema, { target: 'draft-07' });
      generated['x-jdcv-integrity'] = committed['x-jdcv-integrity'];
      expect(generated).toEqual(committed);
    }
  });
});
