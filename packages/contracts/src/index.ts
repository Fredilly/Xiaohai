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

export type StaffLoginRequest = z.infer<typeof staffLoginRequestSchema>;
export type StaffLoginResponse = z.infer<typeof staffLoginResponseSchema>;
export type StaffSession = z.infer<typeof staffSessionSchema>;
