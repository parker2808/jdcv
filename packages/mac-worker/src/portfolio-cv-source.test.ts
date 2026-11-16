import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderDocx, type Cv } from '@jdcv/cv-render';
import { createCvProposal, type CvProposal } from './cv-proposal.js';
import { loadPortfolioCv } from './portfolio-cv-source.js';

const baseUrl = 'https://example.invalid/api/';
const fixtures = {
  site: (lang: 'en' | 'vi') => ({
    profile: {
      displayName: 'Alex Example',
      city: 'Sample City',
      headline: 'Frontend Engineer',
      bio:
        lang === 'en'
          ? 'Builds accessible interfaces for fictional products.'
          : 'Xây dựng giao diện dễ sử dụng cho các sản phẩm giả định.',
      lang,
    },
    socialLinks: [{ url: 'contact available on request' }],
  }),
  experience: (lang: 'en' | 'vi') => [
    {
      id: 1,
      company: 'Example Labs',
      location: 'Sample City',
      role: 'Frontend Engineer',
      summary: '',
      highlights: '',
      startDate: '2023-01-01',
      endDate: null,
      lang,
    },
  ],
  education: (lang: 'en' | 'vi') => [
    {
      id: 1,
      school: 'Example Institute',
      degree: 'Sample Degree',
      major: '',
      startDate: '2020-01-01',
      endDate: '2022-01-01',
      lang,
    },
  ],
  skills: (lang: 'en' | 'vi') => ({
    daily: ['TypeScript', 'Accessibility'].map((name, index) => ({
      id: index + 1,
      name,
      category: { id: 1, name: 'Frontend', lang },
      lang,
    })),
    shipped: [],
    growing: [],
  }),
  projects: {
    items: [{ id: 1, slug: 'project-x' }],
    page: 1,
    pageSize: 100,
    total: 1,
  },
  project: (lang: 'en' | 'vi') => ({
    id: 1,
    slug: 'project-x',
    title: 'Project X',
    role: 'Frontend Engineer',
    startDate: '2023-01-01',
    endDate: null,
    isConfidential: true,
    keyFacts: [
      lang === 'en'
        ? 'Improved keyboard navigation on a sample dashboard.'
        : 'Cải thiện thao tác bằng bàn phím trên bảng điều khiển mẫu.',
    ],
    skills: [{ name: 'TypeScript' }, { name: 'Vue' }],
    experience: { id: 1, company: 'Example Labs' },
    lang,
  }),
};

function fakeFetch(
  override?: (url: URL, body: unknown) => Response | undefined,
): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (
      init?.method !== 'GET' ||
      init.credentials !== 'omit' ||
      init.redirect !== 'error'
    )
      throw new Error('Unexpected request options');
    const lang = url.searchParams.get('locale') as 'en' | 'vi';
    const path = url.pathname.slice('/api/public/'.length);
    const body =
      path === 'site'
        ? fixtures.site(lang)
        : path === 'experience'
          ? fixtures.experience(lang)
          : path === 'education'
            ? fixtures.education(lang)
            : path === 'skills'
              ? fixtures.skills(lang)
              : path === 'projects'
                ? fixtures.projects
                : path === 'projects/project-x'
                  ? fixtures.project(lang)
                  : undefined;
    return (
      override?.(url, body) ??
      new Response(JSON.stringify(body), { status: 200 })
    );
  }) as typeof fetch;
}

describe('published portfolio CV source', () => {
  let root: string;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('cites public fields and yields the same pending proposal shape as synthetic DOCX', async () => {
    root = await mkdtemp(join(tmpdir(), 'jdcv-portfolio-example-'));
    const directory = join(root, 'docx');
    await mkdir(directory);
    const cv = JSON.parse(
      await readFile(
        new URL('../../cv-render/fixtures/alex-example.json', import.meta.url),
        'utf8',
      ),
    ) as Cv;
    cv.experience[0]!.companyAlias = 'Example Labs';
    await writeFile(
      join(directory, 'example.docx'),
      await renderDocx(cv, {
        cvVersionId: 'sample',
        approvedVersionId: 'sample',
        embellishments: [],
      }),
    );
    const jdPath = join(root, 'jd.txt');
    await writeFile(jdPath, 'req-accessibility: keyboard navigation');
    const run = async (source: 'docx' | 'portfolio') => {
      const workspace = join(root, `${source}-workspace`);
      await mkdir(workspace);
      const result = await createCvProposal({
        source,
        directory: source === 'docx' ? directory : join(root, 'absent-docx'),
        portfolioApiUrl: baseUrl,
        portfolioFetch: fakeFetch(),
        repoRoot: process.cwd(),
        jdPath,
        workspace,
        cvVersionId: 'sample',
        signal: new AbortController().signal,
        relay: async (_instructions, output) => {
          const evidence = JSON.parse(
            await readFile(join(workspace, 'cv-source.json'), 'utf8'),
          ) as {
            sourceRef: string;
            text: string;
            pointer: string;
          }[];
          const cite = (value: string) => {
            const found = evidence.find(({ text }) => text.includes(value));
            if (!found) throw new Error('Fixture lacks a cited value');
            return found.sourceRef;
          };
          const baseline = structuredClone(cv);
          const bullet = baseline.experience[0]!.projects[0]!.bullets[0]!;
          bullet.factRef = cite(bullet.text.en);
          const values = [
            ...Object.values(baseline.basics),
            ...Object.values(baseline.summary),
            ...baseline.experience.flatMap((role) => [
              role.companyAlias,
              role.title,
              role.start,
              ...role.projects.flatMap((project) => [
                project.alias,
                ...project.stack,
                ...project.bullets.flatMap((item) => Object.values(item.text)),
              ]),
            ]),
            ...baseline.skills.flatMap((group) => [
              group.group,
              ...group.items,
            ]),
            ...baseline.education.flatMap((item) => Object.values(item)),
          ];
          const proposal: CvProposal = {
            version: 1,
            state: 'awaiting_owner_approval',
            cvVersionId: 'sample',
            cv: baseline,
            facts: [...new Set(values)].map((value) => ({
              kind: 'achievement',
              value,
              sourceRef: cite(value),
            })),
            lines: [
              {
                id: 'edit-1',
                path: 'experience.0.projects.0.bullets.0.text.en',
                before: bullet.text.en,
                after:
                  'Improved keyboard navigation and tested it on a sample dashboard.',
                reason: 'The JD requires keyboard navigation.',
                requirementId: 'req-accessibility',
                sourceRef: bullet.factRef,
                risk: 'medium',
                riskNote: 'Testing is not documented.',
                interviewAnswer:
                  'I must confirm whether I performed that test.',
                defenseEntryId: 'defense-1',
                change: {
                  kind: 'projectDetail',
                  projectId: 'Project X',
                  requirementId: 'req-accessibility',
                  sourceRef: bullet.factRef,
                  roleAndTeamScopeSupported: true,
                },
                embellishment: true,
                decision: 'pending',
                defenseScore: null,
                criticalFindings: 0,
              },
            ],
          };
          await writeFile(output, JSON.stringify(proposal));
        },
      });
      const proposalPath = join(workspace, 'cv-proposal.json');
      await writeFile(proposalPath, JSON.stringify(result));
      const evidence = JSON.parse(
        await readFile(join(workspace, 'cv-source.json'), 'utf8'),
      ) as {
        pointer: string;
        sourceRef: string;
        text: string;
      }[];
      return {
        result: JSON.parse(await readFile(proposalPath, 'utf8')) as CvProposal,
        evidence,
      };
    };
    const docx = await run('docx');
    const portfolio = await run('portfolio');
    const normalize = ({ result, evidence }: typeof docx) => {
      const text = (ref: string) =>
        evidence.find((item) => item.sourceRef === ref)!.text;
      return {
        ...result,
        cv: {
          ...result.cv,
          experience: result.cv.experience.map((role) => ({
            ...role,
            projects: role.projects.map((project) => ({
              ...project,
              bullets: project.bullets.map((bullet) => ({
                ...bullet,
                factRef: bullet.text.en,
              })),
            })),
          })),
        },
        facts: result.facts.map((fact) => ({ ...fact, sourceRef: fact.value })),
        lines: result.lines.map((line) => ({
          ...line,
          sourceRef: line.before,
          change: { ...line.change, sourceRef: line.before },
        })),
        cited: result.facts.every((fact) =>
          text(fact.sourceRef).includes(fact.value),
        ),
      };
    };
    expect(normalize(portfolio)).toEqual(normalize(docx));
    expect(portfolio.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pointer: 'projects[0].keyFacts[0].en' }),
        expect.objectContaining({ pointer: 'projects[0].keyFacts[0].vi' }),
      ]),
    );
  });

  it.each([
    [
      'bad schema',
      (url: URL) => url.pathname.endsWith('/experience'),
      () => new Response(JSON.stringify({ invalid: true })),
      'CV_SOURCE_SCHEMA',
    ],
    [
      'not found',
      (url: URL) => url.pathname.endsWith('/site'),
      () => new Response('', { status: 404 }),
      'CV_SOURCE_HTTP',
    ],
    [
      'server error',
      (url: URL) => url.pathname.endsWith('/site'),
      () => new Response('', { status: 500 }),
      'CV_SOURCE_HTTP',
    ],
    [
      'empty list',
      (url: URL) => url.pathname.endsWith('/experience'),
      () => new Response('[]'),
      'CV_SOURCE_EMPTY',
    ],
  ] as const)('fails closed on %s', async (_name, matches, response, code) => {
    await expect(
      loadPortfolioCv({
        baseUrl,
        fetch: fakeFetch((url) => (matches(url) ? response() : undefined)),
      }),
    ).rejects.toMatchObject({ code });
  });

  it('rejects timeout, network failure, invalid URL and incomplete pages', async () => {
    await expect(
      loadPortfolioCv({
        baseUrl: 'http://example.invalid/api/',
        fetch: fakeFetch(),
      }),
    ).rejects.toMatchObject({ code: 'CV_SOURCE_CONFIG' });
    await expect(
      loadPortfolioCv({
        baseUrl,
        fetch: vi.fn(async () => {
          throw new Error('offline');
        }),
      }),
    ).rejects.toMatchObject({ code: 'CV_SOURCE_NETWORK' });
    await expect(
      loadPortfolioCv({
        baseUrl,
        timeoutMs: 1,
        fetch: vi.fn(
          async (_input, init) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(new Error('aborted')),
              );
            }),
        ),
      }),
    ).rejects.toMatchObject({ code: 'CV_SOURCE_TIMEOUT' });
    await expect(
      loadPortfolioCv({
        baseUrl,
        fetch: fakeFetch((url) =>
          url.pathname.endsWith('/projects')
            ? new Response(
                JSON.stringify({ ...fixtures.projects, total: 2, items: [] }),
              )
            : undefined,
        ),
      }),
    ).rejects.toMatchObject({ code: 'CV_SOURCE_SCHEMA' });
  });

  it('accepts public data without administrator-only fields', async () => {
    const result = await loadPortfolioCv({
      baseUrl,
      locale: 'vi',
      fetch: fakeFetch(),
    });
    expect(result.source).toBe('portfolio');
    expect(result.pointers).toContain('experience[0].role.vi');
  });

  it('never falls back to DOCX when the selected portfolio fails', async () => {
    root = await mkdtemp(join(tmpdir(), 'jdcv-source-failure-'));
    await mkdir(join(root, 'docx'));
    await writeFile(join(root, 'docx', 'example.docx'), 'not a DOCX');
    await writeFile(join(root, 'jd.txt'), 'example requirement');
    await expect(
      createCvProposal({
        source: 'portfolio',
        directory: join(root, 'docx'),
        portfolioApiUrl: baseUrl,
        portfolioFetch: fakeFetch((url) =>
          url.pathname.endsWith('/site')
            ? new Response('', { status: 500 })
            : undefined,
        ),
        repoRoot: process.cwd(),
        workspace: root,
        jdPath: join(root, 'jd.txt'),
        cvVersionId: 'sample',
        signal: new AbortController().signal,
        relay: async () => {
          throw new Error('Relay must not run');
        },
      }),
    ).rejects.toMatchObject({ code: 'CV_SOURCE_HTTP' });
  });
});
