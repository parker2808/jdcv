// Test-only mirror of <private-content-repo> scripts/modules-index.mjs and schema/module.schema.json at f5684a4fa5d6e9d39b8f7ca7e5306e3f5511c382.
// Use fictional in-memory documents only; never import private data or production paths.

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const nonblank = (value: unknown): value is string =>
  typeof value === 'string' && Boolean(value.trim());

function localized(value: unknown, path: string, errors: string[]): void {
  const text = record(value);
  if (!nonblank(text.en) || !nonblank(text.vi))
    errors.push(`${path}: bilingual text required`);
}

function timestamp(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    return false;
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return false;
  const offset = value.endsWith('Z')
    ? 0
    : (value.at(-6) === '-' ? -1 : 1) *
      (Number(value.slice(-5, -3)) * 60 + Number(value.slice(-2)));
  return (
    Math.abs(offset) <= 840 &&
    (value.endsWith('Z') || Number(value.slice(-2)) <= 59) &&
    new Date(instant + offset * 60000).toISOString().slice(0, 19) ===
      value.slice(0, 19)
  );
}

function archive(value: RecordValue, path: string, errors: string[]): void {
  if (!['active', 'archived'].includes(String(value.status)))
    errors.push(`${path}.status`);
  for (const field of ['archivedAt', 'purgeAfter']) {
    if (value.status === 'archived' && !timestamp(value[field]))
      errors.push(`${path}.${field}`);
    if (value.status === 'active' && Object.hasOwn(value, field))
      errors.push(`${path}.${field}`);
  }
  if (
    timestamp(value.archivedAt) &&
    timestamp(value.purgeAfter) &&
    Date.parse(value.purgeAfter) - Date.parse(value.archivedAt) !== 7 * 86400000
  )
    errors.push(`${path}.purgeAfter`);
  if (value.autoArchive !== undefined && typeof value.autoArchive !== 'boolean')
    errors.push(`${path}.autoArchive`);
  if (value.lastOpenedAt !== undefined && !timestamp(value.lastOpenedAt))
    errors.push(`${path}.lastOpenedAt`);
}

const rowFields = [
  'slug',
  'source',
  'fixture',
  'organizationAlias',
  'role',
  'level',
  'date',
  'tags',
  'status',
  'archivedAt',
  'purgeAfter',
  'autoArchive',
  'lastOpenedAt',
  'title',
  'summary',
  'testScore',
] as const;
function rowFor(module: RecordValue): RecordValue {
  const row: RecordValue = {};
  for (const field of rowFields) {
    const value =
      field === 'source' ? `modules/${module.slug}.json` : module[field];
    if (value !== undefined) row[field] = value;
  }
  return row;
}

export function checkContentRules(
  moduleInput: unknown,
  indexInput: unknown,
  originalPackRow: unknown,
): string[] {
  const errors: string[] = [];
  const module = record(moduleInput);
  const index = record(indexInput);
  const legacyPack = record(originalPackRow);
  const legacySlug = legacyPack.slug;
  const legacySource = legacyPack.source;
  const slug = module.slug;
  if (index.version !== 2 || !Array.isArray(index.modules))
    return ['index: expected version 2 and modules array'];
  if (
    typeof legacySlug !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(legacySlug) ||
    !nonblank(legacySource) ||
    legacySource === `modules/${legacySlug}.json` ||
    legacySlug === slug
  ) {
    return ['index: invalid protected pack identity'];
  }
  const rows = array(index.modules).map(record);
  const seen = new Set<unknown>();
  for (const row of rows) {
    if (
      typeof row.slug !== 'string' ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug) ||
      seen.has(row.slug)
    ) {
      errors.push('index: invalid or duplicate slug');
      continue;
    }
    seen.add(row.slug);
    const expected =
      row.slug === legacySlug ? legacySource : `modules/${row.slug}.json`;
    if (
      row.source !== expected ||
      (row.slug !== legacySlug && row.slug !== slug)
    )
      errors.push(`${row.slug}: dangling source`);
    for (const field of ['role', 'level', 'title', 'summary'])
      localized(row[field], `${row.slug}.${field}`, errors);
    archive(row, String(row.slug), errors);
    if (
      row.slug === legacySlug &&
      JSON.stringify(row) !== JSON.stringify(originalPackRow)
    )
      errors.push(`${legacySlug}: index row changed`);
  }
  if (!seen.has(legacySlug)) errors.push(`${legacySlug}: missing index row`);
  if (!seen.has(slug)) errors.push('module: orphan file');
  if (
    module.version !== 2 ||
    typeof slug !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  )
    errors.push('module: invalid version or slug');
  archive(module, String(slug), errors);
  for (const field of ['role', 'level', 'title', 'summary'])
    localized(module[field], `module.${field}`, errors);
  if (
    !nonblank(module.organizationAlias) ||
    !Array.isArray(module.tags) ||
    typeof module.date !== 'string' ||
    Number.isNaN(Date.parse(module.date))
  )
    errors.push('module: invalid metadata');
  const requirements = new Set<unknown>();
  for (const item of array(module.requirements)) {
    const requirement = record(item);
    if (!nonblank(requirement.id) || requirements.has(requirement.id))
      errors.push('module: duplicate or invalid requirement ID');
    requirements.add(requirement.id);
    localized(requirement.title, 'requirement.title', errors);
  }
  const ids = new Set<unknown>();
  for (const item of array(module.entries)) {
    const entry = record(item);
    if (!nonblank(entry.id) || ids.has(entry.id))
      errors.push('module: duplicate or invalid entry ID');
    ids.add(entry.id);
    if (
      ![
        'jd',
        'concepts',
        'interview',
        'pitch',
        'rescue',
        'ask',
        'cheat',
      ].includes(String(entry.section)) ||
      !requirements.has(entry.jdRequirement)
    )
      errors.push('entry: invalid section or requirement');
    if (
      !Array.isArray(entry.tags) ||
      !Array.isArray(entry.keyPoints) ||
      !entry.keyPoints.length
    )
      errors.push('entry: tags and key points required');
    for (const field of ['title', 'shortAnswer', 'detail'])
      localized(entry[field], `entry.${field}`, errors);
    for (const point of array(entry.keyPoints))
      localized(point, 'entry.keyPoints', errors);
    for (const item of array(entry.kbRefs)) {
      const ref = record(item);
      if (
        !ref.slug ||
        !ref.sectionId ||
        !['pending', 'live', 'rejected'].includes(String(ref.state))
      )
        errors.push('entry: malformed KB reference');
    }
    if (
      entry.embellishmentRefs !== undefined &&
      (!Array.isArray(entry.embellishmentRefs) ||
        entry.embellishmentRefs.some((ref) => !nonblank(ref)))
    )
      errors.push('entry: malformed embellishment reference');
  }
  if (!Array.isArray(module.requirements) || !Array.isArray(module.entries))
    errors.push('module: missing requirements or entries');
  const actualRow = rows.find((row) => row.slug === slug);
  if (JSON.stringify(actualRow) !== JSON.stringify(rowFor(module))) {
    for (const field of [
      'status',
      'archivedAt',
      'purgeAfter',
      'autoArchive',
      'lastOpenedAt',
    ]) {
      if (JSON.stringify(actualRow?.[field]) !== JSON.stringify(module[field]))
        errors.push(`index.${field}: disagrees with module`);
    }
    errors.push('index: stale row');
  }
  return errors;
}

export function contentIndexRow(module: RecordValue): RecordValue {
  return rowFor(module);
}
