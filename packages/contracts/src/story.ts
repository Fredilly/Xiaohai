import { z } from 'zod';

export const storyOperationSchema = z.enum(['OUTLINE', 'BODY', 'REWRITE', 'CONTINUE', 'POLISH']);

export const storyContentKindSchema = z.enum(['OUTLINE', 'BODY']);

export const storyPageCountSchema = z.number().int().min(10).max(15);

export const structuredStoryCharacterSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
    visualDescription: z.string().trim().min(10).max(1000),
  })
  .strict();

export const structuredStoryPageSchema = z
  .object({
    pageNumber: z.number().int().positive(),
    scene: z.string().trim().min(1).max(500),
    text: z.string().trim().min(1).max(3000),
  })
  .strict();

export const structuredStorySchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    outline: z.string().trim().min(1).max(2000),
    characters: z.array(structuredStoryCharacterSchema).min(1).max(20),
    pages: z.array(structuredStoryPageSchema).min(10).max(15),
  })
  .strict()
  .superRefine((story, ctx) => {
    const names = new Set<string>();
    story.characters.forEach((character, index) => {
      const normalized = character.name.toLocaleLowerCase();
      if (names.has(normalized)) {
        ctx.addIssue({
          code: 'custom',
          path: ['characters', index, 'name'],
          message: 'Character names must be unique',
        });
      }
      names.add(normalized);
    });

    story.pages.forEach((page, index) => {
      if (page.pageNumber !== index + 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['pages', index, 'pageNumber'],
          message: 'Page numbers must be continuous and start at 1',
        });
      }
    });
  });

export function parseStructuredStoryJson(raw: string, expectedPageCount: number) {
  const pageCount = storyPageCountSchema.parse(expectedPageCount);
  const parsed = structuredStorySchema.parse(JSON.parse(raw) as unknown);

  if (parsed.pages.length !== pageCount) {
    throw new Error('STRUCTURED_STORY_PAGE_COUNT_MISMATCH');
  }

  return parsed;
}

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
    requestedPageCount: storyPageCountSchema.optional(),
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

    if (value.operation === 'BODY' && value.requestedPageCount === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['requestedPageCount'],
        message: 'BODY requires requestedPageCount',
      });
    }

    if (value.operation !== 'BODY' && value.requestedPageCount !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['requestedPageCount'],
        message: 'requestedPageCount is only valid for BODY',
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
  structuredStory: structuredStorySchema.nullable(),
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
export type StructuredStory = z.infer<typeof structuredStorySchema>;
export type CreateStoryWorkRequest = z.infer<typeof createStoryWorkRequestSchema>;
export type StoryGenerateRequest = z.infer<typeof storyGenerateRequestSchema>;
export type StoryWork = z.infer<typeof storyWorkSchema>;
export type StoryVersion = z.infer<typeof storyVersionSchema>;
export type StoryWorkDetail = z.infer<typeof storyWorkDetailSchema>;
export type StoryGenerationAccepted = z.infer<typeof storyGenerationAcceptedSchema>;
export type StoryJobStatus = z.infer<typeof storyJobStatusSchema>;
