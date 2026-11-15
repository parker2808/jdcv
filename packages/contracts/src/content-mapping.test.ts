import { describe, expect, it } from 'vitest';
import {
  contentIndexRow,
  checkContentRules,
} from './fixtures/content-rules.js';
import {
  moduleV2Schema,
  toContentModule,
  type ContentModuleMeta,
} from './index.js';

const worker = moduleV2Schema.parse({
  version: 2,
  requirements: [
    {
      id: 'req-frontend',
      title: { en: 'Build a sample page', vi: 'Làm trang mẫu' },
    },
  ],
  entries: [
    {
      id: 'example-entry',
      section: 'interview',
      jdRequirement: 'req-frontend',
      tags: ['frontend'],
      title: { en: 'How?', vi: 'Làm sao?' },
      shortAnswer: { en: 'Test a small page.', vi: 'Thử một trang nhỏ.' },
      keyPoints: [
        { en: 'Test keyboard input.', vi: 'Thử nhập bằng bàn phím.' },
      ],
      detail: {
        en: 'For example, test a form.',
        vi: 'Ví dụ, thử một biểu mẫu.',
      },
      kbRefs: [{ slug: 'example-topic', sectionId: 'focus', state: 'pending' }],
      embellishmentRefs: [
        {
          id: 'review-example',
          status: 'pending',
          defenseEntryId: 'example-entry',
        },
      ],
    },
  ],
  qualityGate: { passed: true, failures: [] },
});

const meta: ContentModuleMeta = {
  slug: 'example-module',
  organizationAlias: 'Example Labs',
  role: { en: 'Frontend Developer', vi: 'Lập trình viên frontend' },
  level: { en: 'Sample', vi: 'Mẫu' },
  date: '2026-11-16',
  tags: ['frontend'],
  status: 'active',
  title: { en: 'Example module', vi: 'Module ví dụ' },
  summary: { en: 'A fictional study module.', vi: 'Module ôn tập giả định.' },
  testScore: 90,
  fixture: true,
};

const originalPackRow = {
  slug: 'legacy-pack',
  source: 'legacy-pack/legacy-pack-prep.json',
  organizationAlias: 'Example Labs',
  role: meta.role,
  level: meta.level,
  date: meta.date,
  tags: [],
  status: 'active',
  title: meta.title,
  summary: meta.summary,
};

const indexFor = (module: Record<string, unknown>) => ({
  version: 2,
  modules: [originalPackRow, contentIndexRow(module)],
});

describe('reviewed content mapping', () => {
  it('reproduces the raw worker gap and accepts the same reviewed module', () => {
    const original = structuredClone(worker);
    expect(
      checkContentRules(worker, indexFor(worker), originalPackRow).length,
    ).toBeGreaterThan(0);
    const mapped = toContentModule(worker, meta);
    expect(
      checkContentRules(mapped, indexFor(mapped), originalPackRow),
    ).toEqual([]);
    expect(mapped.entries[0].kbRefs).toEqual(worker.entries[0].kbRefs);
    expect(mapped.entries[0].embellishmentRefs).toEqual(['review-example']);
    expect(mapped).not.toHaveProperty('qualityGate');
    expect(worker).toEqual(original);
  });

  it('rejects missing reviewed fields and empty source key points instead of inventing content', () => {
    expect(() =>
      toContentModule(worker, {
        ...meta,
        summary: undefined,
      } as unknown as ContentModuleMeta),
    ).toThrow(/summary/);
    const empty = {
      ...worker,
      entries: [{ ...worker.entries[0], keyPoints: [] }],
    };
    expect(() => toContentModule(empty, meta)).toThrow(
      /entries\[0\]\.keyPoints/,
    );
    expect(() =>
      toContentModule(
        { ...worker, entries: [{ ...worker.entries[0], jdRequirement: '' }] },
        meta,
      ),
    ).toThrow(/entries\[0\]\.jdRequirement/);
  });

  it('keeps archive fields and references under the mirrored rules', () => {
    const archived = toContentModule(worker, {
      ...meta,
      status: 'archived',
      archivedAt: '2026-11-16T00:00:00Z',
      purgeAfter: '2026-11-23T00:00:00Z',
      autoArchive: false,
      lastOpenedAt: '2026-11-16T00:00:00Z',
    });
    expect(
      checkContentRules(archived, indexFor(archived), originalPackRow),
    ).toEqual([]);
    expect(() =>
      toContentModule(worker, { ...meta, status: 'archived' }),
    ).toThrow(/archivedAt/);
    expect(() =>
      toContentModule(worker, { ...meta, archivedAt: '2026-11-16T00:00:00Z' }),
    ).toThrow(/status/);
    const staleIndex = indexFor(archived);
    staleIndex.modules[1].status = 'active';
    expect(checkContentRules(archived, staleIndex, originalPackRow)).toContain(
      'index: stale row',
    );
  });

  it('rejects malformed source references through the unchanged worker schema', () => {
    const malformed = structuredClone(worker);
    malformed.entries[0].kbRefs![0].slug = '';
    expect(() => toContentModule(malformed, meta)).toThrow();
  });

  it('protects the supplied legacy row and refuses unrelated or dangling rows', () => {
    const mapped = toContentModule(worker, meta);
    const changed = indexFor(mapped);
    changed.modules[0] = { ...originalPackRow, organizationAlias: 'Changed' };
    expect(checkContentRules(mapped, changed, originalPackRow)).toContain(
      'legacy-pack: index row changed',
    );
    const missing = { version: 2, modules: [contentIndexRow(mapped)] };
    expect(checkContentRules(mapped, missing, originalPackRow)).toContain(
      'legacy-pack: missing index row',
    );
    const dangling = indexFor(mapped);
    dangling.modules[1].source = 'modules/unrelated.json';
    expect(checkContentRules(mapped, dangling, originalPackRow)).toContain(
      'example-module: dangling source',
    );
    const unrelated = indexFor(mapped);
    unrelated.modules.push({
      ...contentIndexRow(mapped),
      slug: 'unrelated',
      source: 'modules/unrelated.json',
    });
    expect(checkContentRules(mapped, unrelated, originalPackRow)).toContain(
      'unrelated: dangling source',
    );
    expect(
      checkContentRules(mapped, indexFor(mapped), {
        ...originalPackRow,
        source: 'modules/legacy-pack.json',
      }),
    ).toContain('index: invalid protected pack identity');
  });
});
