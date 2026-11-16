import { z } from 'zod';
import { PrivateCvError } from './cv-source-error.js';

const localeSchema = z.enum(['en', 'vi']);
const id = z.number().int();
const text = z.string();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const experienceSchema = z.object({
  id,
  company: text,
  location: text,
  role: text,
  summary: text,
  highlights: text,
  startDate: date,
  endDate: date.nullable(),
  lang: localeSchema,
});
const educationSchema = z.object({
  id,
  school: text,
  degree: text,
  major: text,
  startDate: date,
  endDate: date,
  lang: localeSchema,
});
const skillSchema = z.object({
  id,
  name: text,
  category: z.object({ id, name: text, lang: localeSchema }),
  lang: localeSchema,
});
const skillsSchema = z.object({
  daily: z.array(skillSchema),
  shipped: z.array(skillSchema),
  growing: z.array(skillSchema),
});
const projectItemSchema = z.object({
  id,
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
});
const projectsSchema = z.object({
  items: z.array(projectItemSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
const projectSchema = projectItemSchema.extend({
  title: text,
  role: text,
  startDate: date,
  endDate: date.nullable(),
  isConfidential: z.boolean(),
  keyFacts: z.array(text),
  skills: z.array(z.object({ name: text })),
  experience: z.object({ id, company: text }).nullable(),
  lang: localeSchema,
});
const siteSchema = z.object({
  profile: z.object({
    displayName: text,
    city: text,
    headline: text,
    bio: text,
    lang: localeSchema,
  }),
  socialLinks: z.array(z.object({ url: text })),
});

export type PortfolioEvidence = {
  paragraphs: string[];
  pointers: string[];
  source: 'portfolio';
};

export async function loadPortfolioCv(options: {
  baseUrl?: string;
  locale?: 'en' | 'vi';
  signal?: AbortSignal;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<PortfolioEvidence> {
  let base: URL;
  try {
    base = new URL(options.baseUrl ?? '');
    if (
      base.protocol !== 'https:' ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !base.pathname.endsWith('/')
    )
      throw new Error();
  } catch {
    throw new PrivateCvError('CV_SOURCE_CONFIG');
  }
  const locale = options.locale ?? 'en';
  if (!localeSchema.safeParse(locale).success)
    throw new PrivateCvError('CV_SOURCE_CONFIG');
  const fetcher = options.fetch ?? fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 8_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;

  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const url = new URL(path, base);
    let response: Response;
    try {
      response = await fetcher(url, {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        signal,
      });
    } catch {
      throw new PrivateCvError(
        timeout.aborted ? 'CV_SOURCE_TIMEOUT' : 'CV_SOURCE_NETWORK',
      );
    }
    if (!response.ok) throw new PrivateCvError('CV_SOURCE_HTTP');
    try {
      const body = await response.text();
      if (body.length > 2_000_000) throw new Error();
      const parsed = schema.safeParse(JSON.parse(body));
      if (!parsed.success) throw new Error();
      return parsed.data;
    } catch {
      throw new PrivateCvError(
        timeout.aborted ? 'CV_SOURCE_TIMEOUT' : 'CV_SOURCE_SCHEMA',
      );
    }
  }

  const paragraphs: string[] = [];
  const pointers: string[] = [];
  function add(pointer: string, value: string | null): void {
    if (value?.trim()) {
      paragraphs.push(value.trim());
      pointers.push(pointer);
    }
  }
  const locales =
    locale === 'en' ? (['en', 'vi'] as const) : (['vi', 'en'] as const);
  const seenProjects = new Set<string>();
  for (const language of locales) {
    const query = `?locale=${language}`;
    const site = await get(`public/site${query}`, siteSchema);
    const experiences = await get(
      `public/experience${query}`,
      z.array(experienceSchema),
    );
    const education = await get(
      `public/education${query}`,
      z.array(educationSchema),
    );
    const skills = await get(`public/skills${query}`, skillsSchema);
    const projects: z.infer<typeof projectItemSchema>[] = [];
    let expectedTotal: number | undefined;
    for (let page = 1; page <= 10; page++) {
      const result = await get(
        `public/projects${query}&page=${page}&pageSize=100`,
        projectsSchema,
      );
      expectedTotal ??= result.total;
      if (
        result.page !== page ||
        result.pageSize !== 100 ||
        result.total !== expectedTotal ||
        result.total > 1000 ||
        projects.length + result.items.length > result.total ||
        (projects.length + result.items.length < result.total &&
          !result.items.length)
      )
        throw new PrivateCvError('CV_SOURCE_SCHEMA');
      projects.push(...result.items);
      if (projects.length === result.total) break;
    }
    if (projects.length !== expectedTotal)
      throw new PrivateCvError('CV_SOURCE_SCHEMA');
    if (
      !site.profile.displayName.trim() ||
      !site.profile.headline.trim() ||
      !site.profile.city.trim() ||
      !site.profile.bio.trim() ||
      !experiences.length ||
      !education.length ||
      !Object.values(skills).some((group) => group.length) ||
      !projects.length ||
      !site.socialLinks.some((link) => link.url.trim()) ||
      experiences.some(
        (entry) => !entry.company.trim() || !entry.role.trim(),
      ) ||
      education.some((entry) => !entry.school.trim() || !entry.degree.trim())
    )
      throw new PrivateCvError('CV_SOURCE_EMPTY');

    add(
      `site.profile.displayName.${site.profile.lang}`,
      site.profile.displayName,
    );
    add(`site.profile.headline.${site.profile.lang}`, site.profile.headline);
    add('site.profile.city', site.profile.city);
    add(`site.profile.bio.${site.profile.lang}`, site.profile.bio);
    site.socialLinks.forEach((link, index) =>
      add(`site.socialLinks[${index}].url`, link.url),
    );
    experiences.forEach((entry, index) => {
      const path = `experience[${index}]`;
      add(`${path}.company`, entry.company);
      add(`${path}.location`, entry.location);
      add(`${path}.role.${entry.lang}`, entry.role);
      add(`${path}.startDate`, entry.startDate);
      add(`${path}.endDate`, entry.endDate);
      add(`${path}.summary.${entry.lang}`, entry.summary);
      entry.highlights
        .split(/\r?\n/u)
        .forEach((highlight, position) =>
          add(`${path}.highlights[${position}].${entry.lang}`, highlight),
        );
    });
    education.forEach((entry, index) => {
      const path = `education[${index}]`;
      add(`${path}.school`, entry.school);
      add(`${path}.degree.${entry.lang}`, entry.degree);
      add(`${path}.major.${entry.lang}`, entry.major);
      add(`${path}.startDate`, entry.startDate);
      add(`${path}.endDate`, entry.endDate);
    });
    for (const [group, entries] of Object.entries(skills))
      entries.forEach((entry, index) => {
        add(`skills.${group}[${index}].name`, entry.name);
        add(
          `skills.${group}[${index}].category.${entry.category.lang}`,
          entry.category.name,
        );
      });
    for (const [index, item] of projects.entries()) {
      if (seenProjects.has(`${language}:${item.slug}`))
        throw new PrivateCvError('CV_SOURCE_SCHEMA');
      seenProjects.add(`${language}:${item.slug}`);
      const detail = await get(
        `public/projects/${encodeURIComponent(item.slug)}${query}`,
        projectSchema,
      );
      if (detail.id !== item.id || detail.slug !== item.slug)
        throw new PrivateCvError('CV_SOURCE_SCHEMA');
      if (!detail.title.trim() || !detail.role.trim())
        throw new PrivateCvError('CV_SOURCE_EMPTY');
      const path = `projects[${index}]`;
      add(`${path}.title.${detail.lang}`, detail.title);
      add(`${path}.role.${detail.lang}`, detail.role);
      add(`${path}.startDate`, detail.startDate);
      add(`${path}.endDate`, detail.endDate);
      add(`${path}.experience.company`, detail.experience?.company ?? null);
      detail.skills.forEach((skill, position) =>
        add(`${path}.skills[${position}].name`, skill.name),
      );
      detail.keyFacts.forEach((fact, position) =>
        add(`${path}.keyFacts[${position}].${detail.lang}`, fact),
      );
    }
  }
  if (!paragraphs.length) throw new PrivateCvError('CV_SOURCE_EMPTY');
  return { paragraphs, pointers, source: 'portfolio' };
}
