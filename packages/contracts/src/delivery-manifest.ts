import { z } from 'zod';

const identifier = z.string().min(1);
const decision = z.enum(['approved', 'rejected']);
const proposedChange = z.union([
  z.strictObject({
    kind: z.enum([
      'employer',
      'title',
      'date',
      'project',
      'credential',
      'experienceYears',
    ]),
  }),
  z.strictObject({
    kind: z.enum(['wording', 'projectDetail', 'estimate']),
    projectId: identifier,
    requirementId: identifier,
    sourceRef: identifier,
    technology: identifier.optional(),
    technologyAvailableSince: z.number().int().optional(),
    estimateAuthorized: z.boolean().optional(),
    estimateRangeDocumented: z.boolean().optional(),
    roleAndTeamScopeSupported: z.boolean(),
  }),
]);

export const deliveryManifestSchema = z.strictObject({
  version: z.literal(1),
  jobId: identifier,
  cvVersionId: identifier,
  ownerId: identifier,
  createdAt: z.iso.datetime({ offset: true }),
  diff: z.array(
    z.strictObject({
      id: identifier,
      path: z
        .string()
        .regex(/^experience\.\d+\.projects\.\d+\.bullets\.\d+\.text\.(en|vi)$/),
      before: identifier,
      after: identifier,
      reason: identifier,
      requirementId: identifier,
      sourceRef: z.string().regex(/^cv:paragraph:\d+$/),
      risk: z.enum(['low', 'medium', 'high']),
      riskNote: identifier,
      interviewAnswer: identifier,
      defenseEntryId: identifier,
      change: proposedChange,
      embellishment: z.boolean(),
      decision,
      defenseScore: z.number().min(0).max(5).nullable(),
      criticalFindings: z.number().int().nonnegative(),
    }),
  ),
  approval: z.strictObject({
    cvVersionId: identifier,
    approvedVersionId: identifier,
    embellishments: z.array(
      z.strictObject({
        id: identifier,
        status: decision,
        lineApproved: z.boolean(),
        defenseEntryId: identifier.nullable(),
        defenseScore: z.number().min(0).max(5).nullable(),
        criticalFindings: z.number().int().nonnegative(),
      }),
    ),
  }),
  docx: z.strictObject({
    fileName: z.string().regex(/^[^./\\][^/\\]*\.docx$/),
    size: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  pdf: z.strictObject({
    fileName: z.string().regex(/^[^./\\][^/\\]*\.pdf$/),
    size: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});

export type DeliveryManifest = z.infer<typeof deliveryManifestSchema>;
