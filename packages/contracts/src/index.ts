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
