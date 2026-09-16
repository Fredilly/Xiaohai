import { z } from 'zod';

export const pictureBookStatusSchema = z.enum(['DRAFT', 'PLANNED', 'ILLUSTRATING', 'READY']);

export const pictureBookPageKindSchema = z.enum(['COVER', 'CONTENT']);

export const pictureBookCharacterRoleSchema = z.enum(['MAIN', 'SUPPORTING']);

export const pictureBookIllustrationStatusSchema = z.enum(['QUEUED', 'RUNNING', 'READY', 'FAILED']);

export const createPictureBookRequestSchema = z
  .object({
    storyWorkId: z.uuid(),
    sourceStoryVersionId: z.uuid(),
    title: z.string().trim().min(1).max(120).optional(),
    layoutPreset: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const pictureBookSchema = z
  .object({
    id: z.uuid(),
    storyWorkId: z.uuid(),
    sourceStoryVersionId: z.uuid(),
    title: z.string().min(1),
    status: pictureBookStatusSchema,
    layoutPreset: z.string().min(1).max(64),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const characterProfileSchema = z
  .object({
    id: z.uuid(),
    pictureBookId: z.uuid(),
    name: z.string().min(1),
    role: pictureBookCharacterRoleSchema,
    description: z.string().min(1),
    visualPrompt: z.string().min(1),
    consistencyKey: z.uuid(),
    referenceMediaAssetId: z.uuid().nullable(),
    sourceAiJobId: z.uuid().nullable(),
    sortOrder: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const pictureBookIllustrationSchema = z
  .object({
    id: z.uuid(),
    pageId: z.uuid(),
    revisionNumber: z.number().int().positive(),
    prompt: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
    status: pictureBookIllustrationStatusSchema,
    errorCode: z.string().nullable(),
    sourceAiJobId: z.uuid().nullable(),
    mediaAssetId: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === 'READY' && value.mediaAssetId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['mediaAssetId'],
        message: 'READY illustration requires mediaAssetId',
      });
    }
  });

export const pictureBookPageSchema = z
  .object({
    id: z.uuid(),
    pictureBookId: z.uuid(),
    pageNumber: z.number().int().nonnegative(),
    pageKind: pictureBookPageKindSchema,
    storyText: z.string().min(1).nullable(),
    sceneDescription: z.string().min(1).nullable(),
    illustrationPrompt: z.string().min(1).nullable(),
    layoutPreset: z.string().min(1).max(64),
    sourceAiJobId: z.uuid().nullable(),
    illustrations: z.array(pictureBookIllustrationSchema),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.pageKind === 'COVER' && value.pageNumber !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['pageNumber'],
        message: 'COVER pageNumber must be 0',
      });
    }

    if (value.pageKind === 'CONTENT' && value.pageNumber <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['pageNumber'],
        message: 'CONTENT pageNumber must be greater than 0',
      });
    }

    if (value.pageKind === 'CONTENT' && value.storyText === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['storyText'],
        message: 'CONTENT page requires storyText',
      });
    }
  });

export const pictureBookDetailSchema = z
  .object({
    pictureBook: pictureBookSchema,
    characters: z.array(characterProfileSchema),
    pages: z.array(pictureBookPageSchema),
  })
  .strict();

export const pictureBookListSchema = z
  .object({
    pictureBooks: z.array(pictureBookSchema),
  })
  .strict();

export type PictureBookStatus = z.infer<typeof pictureBookStatusSchema>;
export type PictureBookPageKind = z.infer<typeof pictureBookPageKindSchema>;
export type PictureBookCharacterRole = z.infer<typeof pictureBookCharacterRoleSchema>;
export type PictureBookIllustrationStatus = z.infer<typeof pictureBookIllustrationStatusSchema>;
export type CreatePictureBookRequest = z.infer<typeof createPictureBookRequestSchema>;
export type PictureBook = z.infer<typeof pictureBookSchema>;
export type CharacterProfile = z.infer<typeof characterProfileSchema>;
export type PictureBookIllustration = z.infer<typeof pictureBookIllustrationSchema>;
export type PictureBookPage = z.infer<typeof pictureBookPageSchema>;
export type PictureBookDetail = z.infer<typeof pictureBookDetailSchema>;

export const pictureBookTextOperationSchema = z.enum(['CHARACTERS', 'STORYBOARD']);

export const pictureBookGenerateRequestSchema = z
  .object({
    operation: pictureBookTextOperationSchema,
  })
  .strict();

export const pictureBookGenerationAcceptedSchema = z
  .object({
    pictureBookId: z.uuid(),
    jobId: z.uuid(),
    operation: pictureBookTextOperationSchema,
    status: z.literal('QUEUED'),
  })
  .strict();

export const applyPictureBookJobRequestSchema = z
  .object({
    jobId: z.uuid(),
  })
  .strict();

export const pictureBookCharacterDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    role: pictureBookCharacterRoleSchema,
    description: z.string().trim().min(1).max(1000),
    visualPrompt: z.string().trim().min(1).max(2000),
  })
  .strict();

export const pictureBookCharacterPlanSchema = z
  .object({
    characters: z.array(pictureBookCharacterDraftSchema).min(1).max(12),
  })
  .strict()
  .superRefine((value, ctx) => {
    const names = value.characters.map((character) => character.name);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['characters'],
        message: 'Character names must be unique',
      });
    }
  });

export const pictureBookStoryboardPageDraftSchema = z
  .object({
    storyText: z.string().trim().min(1).max(3000),
    sceneDescription: z.string().trim().min(1).max(2000),
    illustrationPrompt: z.string().trim().min(1).max(3000),
    layoutPreset: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const pictureBookStoryboardPlanSchema = z
  .object({
    cover: z
      .object({
        sceneDescription: z.string().trim().min(1).max(2000),
        illustrationPrompt: z.string().trim().min(1).max(3000),
        layoutPreset: z.string().trim().min(1).max(64).optional(),
      })
      .strict(),
    pages: z.array(pictureBookStoryboardPageDraftSchema).min(1).max(40),
  })
  .strict();

export const pictureBookJobStatusSchema = z
  .object({
    jobId: z.uuid(),
    pictureBookId: z.uuid(),
    operation: pictureBookTextOperationSchema,
    status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
    generatedText: z.string().nullable(),
    applied: z.boolean(),
    lastErrorCode: z.string().nullable(),
  })
  .strict();

export type PictureBookTextOperation = z.infer<typeof pictureBookTextOperationSchema>;
export type PictureBookGenerateRequest = z.infer<typeof pictureBookGenerateRequestSchema>;
export type PictureBookGenerationAccepted = z.infer<typeof pictureBookGenerationAcceptedSchema>;
export type PictureBookCharacterDraft = z.infer<typeof pictureBookCharacterDraftSchema>;
export type PictureBookCharacterPlan = z.infer<typeof pictureBookCharacterPlanSchema>;
export type PictureBookStoryboardPageDraft = z.infer<typeof pictureBookStoryboardPageDraftSchema>;
export type PictureBookStoryboardPlan = z.infer<typeof pictureBookStoryboardPlanSchema>;
export type PictureBookJobStatus = z.infer<typeof pictureBookJobStatusSchema>;

export const pictureBookIllustrationAcceptedSchema = z
  .object({
    pictureBookId: z.uuid(),
    pageId: z.uuid(),
    illustrationId: z.uuid(),
    revisionNumber: z.number().int().positive(),
    status: z.literal('QUEUED'),
  })
  .strict();

export const pictureBookIllustrationListSchema = z
  .object({ illustrations: z.array(pictureBookIllustrationSchema) })
  .strict();

export type PictureBookIllustrationAccepted = z.infer<typeof pictureBookIllustrationAcceptedSchema>;
