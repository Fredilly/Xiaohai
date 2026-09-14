import { z } from 'zod';

export const healthResponseSchema = z.object({ status: z.literal('ok'), service: z.string() });
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const wechatLoginRequestSchema = z
  .object({ code: z.string().trim().min(1).max(128) })
  .strict();

export const consumerSessionSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.iso.datetime(),
});

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
  'INTERNAL_ERROR',
]);

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    requestId: z.string(),
  }),
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

export const staffSessionSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.iso.datetime(),
});

export const staffLoginResponseSchema = z.object({
  staff: z.object({ id: z.uuid(), loginIdentifier: z.string() }),
  session: staffSessionSchema,
});

export const staffDataScopeTypeSchema = z.enum(['GLOBAL', 'REGION', 'FRANCHISEE', 'STORE']);
export const staffDataScopeSchema = z.object({
  type: staffDataScopeTypeSchema,
  id: z.uuid().nullable(),
});

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
    if (value.scopeType === 'GLOBAL' && value.scopeId !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'GLOBAL scope must not include scopeId' });
    }
    if (value.scopeType !== 'GLOBAL' && value.scopeId === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Non-GLOBAL scope requires scopeId' });
    }
  });

export const staffAuthorizationProbeResponseSchema = z.object({ allowed: z.literal(true) });

export type StaffLoginRequest = z.infer<typeof staffLoginRequestSchema>;
export type StaffLoginResponse = z.infer<typeof staffLoginResponseSchema>;
export type StaffSession = z.infer<typeof staffSessionSchema>;
export type StaffDataScopeType = z.infer<typeof staffDataScopeTypeSchema>;
export type StaffDataScope = z.infer<typeof staffDataScopeSchema>;
export type StaffMeResponse = z.infer<typeof staffMeResponseSchema>;
export type StaffAuthorizationProbeQuery = z.infer<typeof staffAuthorizationProbeQuerySchema>;
