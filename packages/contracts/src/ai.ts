import { z } from 'zod';

export const aiProviderSchema = z.enum(['MOCK', 'DEEPSEEK']);
export const aiJobStatusSchema = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']);
export const createAiJobRequestSchema = z
  .object({
    projectTitle: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(20000),
    provider: aiProviderSchema,
    model: z.string().trim().min(1).max(120),
    timeoutMs: z.number().int().min(1000).max(300000).default(30000),
    maxAttempts: z.number().int().min(1).max(10).default(3),
  })
  .strict();
export const aiJobSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    projectTitle: z.string(),
    provider: aiProviderSchema,
    model: z.string(),
    status: aiJobStatusSchema,
    result: z
      .object({ text: z.string().optional(), assetReferences: z.array(z.string()).optional() })
      .nullable(),
    moderation: z
      .object({
        input: z.string(),
        output: z.string().optional(),
        reasonCodes: z.array(z.string()),
      })
      .nullable(),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
        totalTokens: z.number().int().nonnegative().optional(),
      })
      .nullable(),
    costMetadata: z.record(z.string(), z.unknown()).nullable(),
    attemptCount: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
    lastErrorCode: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export const aiJobListSchema = z.object({ jobs: z.array(aiJobSchema) }).strict();
export type AiJob = z.infer<typeof aiJobSchema>;
