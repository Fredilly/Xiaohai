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
    status: pictureBookIllustrationStatusSchema,
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
