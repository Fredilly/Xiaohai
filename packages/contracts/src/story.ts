import { z } from 'zod';

export const storyOperationSchema = z.enum(['OUTLINE', 'BODY', 'REWRITE', 'CONTINUE', 'POLISH']);

export const storyContentKindSchema = z.enum(['OUTLINE', 'BODY']);

export const storyControlsSchema = z
  .object({
    idea: z.string().trim().min(1).max(2000),
    ageRange: z.string().trim().min(1).max(40),
    theme: z.string().trim().min(1).max(120),
    style: z.string().trim().min(1).max(120),
  })
  .strict();

export const createStoryWorkRequestSchema = storyControlsSchema
  .extend({
    title: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const storyGenerateRequestSchema = z
  .object({
    operation: storyOperationSchema,
    sourceVersionId: z.uuid().optional(),
    instruction: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.operation === 'OUTLINE' && value.sourceVersionId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceVersionId'],
        message: 'OUTLINE must not include sourceVersionId',
      });
    }

    if (value.operation !== 'OUTLINE' && value.sourceVersionId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceVersionId'],
        message: `${value.operation} requires sourceVersionId`,
      });
    }
  });

export const storyWorkSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  workType: z.literal('STORY'),
  controls: storyControlsSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const storyVersionSchema = z.object({
  id: z.uuid(),
  workId: z.uuid(),
  versionNumber: z.number().int().positive(),
  contentKind: storyContentKindSchema,
  operation: storyOperationSchema,
  sourceVersionId: z.uuid().nullable(),
  sourceAiJobId: z.uuid(),
  content: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export const storyWorkDetailSchema = z.object({
  work: storyWorkSchema,
  versions: z.array(storyVersionSchema),
});

export const storyWorkListSchema = z.object({
  works: z.array(storyWorkSchema),
});

export const storyGenerationAcceptedSchema = z.object({
  workId: z.uuid(),
  jobId: z.uuid(),
  operation: storyOperationSchema,
  status: z.literal('QUEUED'),
});

export const saveStoryVersionRequestSchema = z
  .object({
    jobId: z.uuid(),
  })
  .strict();

export const storyJobStatusSchema = z.object({
  jobId: z.uuid(),
  workId: z.uuid(),
  operation: storyOperationSchema,
  status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
  generatedText: z.string().nullable(),
  savedVersionId: z.uuid().nullable(),
  lastErrorCode: z.string().nullable(),
});

export type StoryOperation = z.infer<typeof storyOperationSchema>;
export type StoryContentKind = z.infer<typeof storyContentKindSchema>;
export type StoryControls = z.infer<typeof storyControlsSchema>;
export type CreateStoryWorkRequest = z.infer<typeof createStoryWorkRequestSchema>;
export type StoryGenerateRequest = z.infer<typeof storyGenerateRequestSchema>;
export type StoryWork = z.infer<typeof storyWorkSchema>;
export type StoryVersion = z.infer<typeof storyVersionSchema>;
export type StoryWorkDetail = z.infer<typeof storyWorkDetailSchema>;
export type StoryGenerationAccepted = z.infer<typeof storyGenerationAcceptedSchema>;
export type StoryJobStatus = z.infer<typeof storyJobStatusSchema>;
