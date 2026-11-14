import { z } from 'zod';

const bilingual = z
  .object({ en: z.string().min(1), vi: z.string().min(1) })
  .strict();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const cvSchema = z
  .object({
    basics: z
      .object({
        name: z.string().min(1),
        headline: z.string().min(1),
        location: z.string().min(1),
        contact: z.string().min(1),
      })
      .strict(),
    summary: bilingual,
    experience: z.array(
      z
        .object({
          companyAlias: z.string().min(1),
          confidential: z.boolean(),
          title: z.string().min(1),
          start: month,
          end: month.nullable(),
          projects: z.array(
            z
              .object({
                alias: z.string().min(1),
                start: month.optional(),
                end: month.nullable().optional(),
                stack: z.array(z.string().min(1)),
                bullets: z.array(
                  z
                    .object({
                      text: bilingual,
                      factRef: z.string().min(1),
                      embellishmentId: z.string().min(1).nullable(),
                    })
                    .strict(),
                ),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    skills: z.array(
      z
        .object({ group: z.string().min(1), items: z.array(z.string().min(1)) })
        .strict(),
    ),
    education: z.array(
      z
        .object({
          institution: z.string().min(1),
          qualification: z.string().min(1),
          year: z.string().min(1),
        })
        .strict(),
    ),
    locale: z.enum(['en', 'vi']),
    templateId: z.literal('ats-classic'),
    jdId: z.string().min(1),
  })
  .strict();

export type Cv = z.infer<typeof cvSchema>;

export const approvalSchema = z
  .object({
    cvVersionId: z.string().min(1),
    approvedVersionId: z.string().min(1),
    embellishments: z.array(
      z
        .object({
          id: z.string().min(1),
          status: z.enum(['proposed', 'approved', 'rejected']),
          lineApproved: z.boolean(),
          defenseEntryId: z.string().min(1).nullable(),
          defenseScore: z.number().min(0).max(5).nullable(),
          criticalFindings: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();

export type ExportApproval = z.infer<typeof approvalSchema>;
