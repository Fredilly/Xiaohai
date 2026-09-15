import { z } from 'zod';

export const healthResponseSchema = z.object({ status: z.literal('ok'), service: z.string() });
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const wechatLoginRequestSchema = z
  .object({ code: z.string().trim().min(1).max(128) })
  .strict();
export const consumerSessionSchema = z.object({ token: z.string().min(1), expiresAt: z.iso.datetime() });
export const wechatLoginResponseSchema = z.object({
  consumer: z.object({ id: z.uuid() }),
  session: consumerSessionSchema,
});

export const apiErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'WECHAT_CODE_INVALID',
  'WECHAT_PROVIDER_UNAVAILABLE',
  'WECHAT_RESPONSE_INVALID',
  'STAFF_AUTHENTICATION_FAILED',
  'STAFF_AUTHENTICATION_REQUIRED',
  'STAFF_FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL_ERROR',
]);
export const apiErrorResponseSchema = z.object({
  error: z.object({ code: apiErrorCodeSchema, message: z.string(), requestId: z.string() }),
});

export type WeChatLoginRequest = z.infer<typeof wechatLoginRequestSchema>;
export type WeChatLoginResponse = z.infer<typeof wechatLoginResponseSchema>;
export type ConsumerSession = z.infer<typeof consumerSessionSchema>;
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

export const staffLoginRequestSchema = z
  .object({
    loginIdentifier: z.string().trim().min(3).max(128),
    password: z.string().min(8).max(256),
  })
  .strict();
export const staffSessionSchema = z.object({ token: z.string().min(1), expiresAt: z.iso.datetime() });
export const staffLoginResponseSchema = z.object({
  staff: z.object({ id: z.uuid(), loginIdentifier: z.string() }),
  session: staffSessionSchema,
});
export const staffDataScopeTypeSchema = z.enum(['GLOBAL', 'REGION', 'FRANCHISEE', 'STORE']);
export const staffDataScopeSchema = z.object({ type: staffDataScopeTypeSchema, id: z.uuid().nullable() });
export const staffMeResponseSchema = z.object({
  staff: z.object({ id: z.uuid(), loginIdentifier: z.string() }),
  permissions: z.array(z.string()),
  dataScopes: z.array(staffDataScopeSchema),
});
export const staffAuthorizationProbeQuerySchema = z
  .object({
    permission: z.string().trim().min(3).max(128),
    scopeType: staffDataScopeTypeSchema,
    scopeId: z.uuid().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scopeType === 'GLOBAL' && value.scopeId !== undefined)
      ctx.addIssue({ code: 'custom', message: 'GLOBAL scope must not include scopeId' });
    if (value.scopeType !== 'GLOBAL' && value.scopeId === undefined)
      ctx.addIssue({ code: 'custom', message: 'Non-GLOBAL scope requires scopeId' });
  });
export const staffAuthorizationProbeResponseSchema = z.object({ allowed: z.literal(true) });

export type StaffLoginRequest = z.infer<typeof staffLoginRequestSchema>;
export type StaffLoginResponse = z.infer<typeof staffLoginResponseSchema>;
export type StaffSession = z.infer<typeof staffSessionSchema>;
export type StaffDataScopeType = z.infer<typeof staffDataScopeTypeSchema>;
export type StaffDataScope = z.infer<typeof staffDataScopeSchema>;
export type StaffMeResponse = z.infer<typeof staffMeResponseSchema>;
export type StaffAuthorizationProbeQuery = z.infer<typeof staffAuthorizationProbeQuerySchema>;

export const cmsPublicationStateSchema = z.enum(['DRAFT', 'PUBLISHED']);
export const cmsSectionTypeSchema = z.enum(['HERO', 'FEATURE_GRID', 'CONTENT_LIST', 'BANNER']);
export const cmsActionSchema = z
  .object({ type: z.literal('PREVIEW'), target: z.string().trim().min(1).max(64) })
  .strict();
const heroConfigSchema = z.object({ eyebrow: z.string().trim().max(80).optional() }).strict();
const featureGridConfigSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(64),
            title: z.string().trim().min(1).max(120),
            subtitle: z.string().trim().max(240).optional(),
            badge: z.string().trim().max(40).optional(),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
const contentListConfigSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(120),
            subtitle: z.string().trim().max(240).optional(),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
const bannerConfigSchema = z.object({ body: z.string().trim().min(1).max(500) }).strict();

const cmsSectionFieldsSchema = z
  .object({
    sectionType: cmsSectionTypeSchema,
    title: z.string().trim().min(1).max(120),
    subtitle: z.string().trim().max(240).nullable().optional(),
    displayOrder: z.number().int().min(0).max(10000),
    enabled: z.boolean(),
    config: z.unknown(),
    mediaUrl: z.url().max(2048).nullable().optional(),
    action: cmsActionSchema.nullable().optional(),
    publicationState: cmsPublicationStateSchema,
  })
  .strict();

function validateCmsConfig(
  value: { sectionType: z.infer<typeof cmsSectionTypeSchema>; config: unknown },
  ctx: z.RefinementCtx,
) {
  const schema = {
    HERO: heroConfigSchema,
    FEATURE_GRID: featureGridConfigSchema,
    CONTENT_LIST: contentListConfigSchema,
    BANNER: bannerConfigSchema,
  }[value.sectionType];
  if (!schema.safeParse(value.config).success)
    ctx.addIssue({ code: 'custom', path: ['config'], message: 'Invalid config for section type' });
}

export const cmsSectionInputSchema = cmsSectionFieldsSchema.superRefine(validateCmsConfig);
export const updateCmsSectionRequestSchema = cmsSectionFieldsSchema
  .partial()
  .extend({ version: z.number().int().positive() })
  .strict();
export const cmsSectionSchema = cmsSectionFieldsSchema
  .extend({ id: z.uuid(), version: z.number().int().positive(), updatedAt: z.iso.datetime() })
  .superRefine(validateCmsConfig);
export const publicCmsSectionSchema = cmsSectionFieldsSchema
  .omit({ publicationState: true, enabled: true })
  .omit({})
  .extend({ id: z.uuid() })
  .omit({});
export const publicHomeResponseSchema = z.object({
  page: z.object({ key: z.literal('HOME'), title: z.string() }),
  sections: z.array(
    z.object({
      id: z.uuid(),
      sectionType: cmsSectionTypeSchema,
      title: z.string(),
      subtitle: z.string().nullable().optional(),
      displayOrder: z.number().int().nonnegative(),
      config: z.unknown(),
      mediaUrl: z.url().nullable().optional(),
      action: cmsActionSchema.nullable().optional(),
    }),
  ),
});
export const adminHomeResponseSchema = z.object({
  page: z.object({
    key: z.literal('HOME'),
    title: z.string(),
    publicationState: cmsPublicationStateSchema,
    version: z.number().int().positive(),
  }),
  sections: z.array(cmsSectionSchema),
});
export const createCmsSectionRequestSchema = cmsSectionInputSchema;
export const reorderCmsSectionsRequestSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.uuid(),
            version: z.number().int().positive(),
            displayOrder: z.number().int().min(0).max(10000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.items.map((item) => item.id)).size !== value.items.length)
      ctx.addIssue({ code: 'custom', message: 'Section ids must be unique' });
    if (new Set(value.items.map((item) => item.displayOrder)).size !== value.items.length)
      ctx.addIssue({ code: 'custom', message: 'Display orders must be unique' });
  });
export const updateCmsPageRequestSchema = z
  .object({ publicationState: cmsPublicationStateSchema, version: z.number().int().positive() })
  .strict();

export type CmsSectionInput = z.infer<typeof cmsSectionInputSchema>;
export type CmsSection = z.infer<typeof cmsSectionSchema>;
export type PublicHomeResponse = z.infer<typeof publicHomeResponseSchema>;
export type AdminHomeResponse = z.infer<typeof adminHomeResponseSchema>;
export type UpdateCmsSectionRequest = z.infer<typeof updateCmsSectionRequestSchema>;
export type ReorderCmsSectionsRequest = z.infer<typeof reorderCmsSectionsRequestSchema>;
