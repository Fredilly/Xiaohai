import { z } from 'zod';

export const animationStatusSchema = z.enum([
  'DRAFT',
  'SCRIPT_READY',
  'STORYBOARD_READY',
  'GENERATING',
  'COMPOSING',
  'READY',
  'FAILED',
  'CANCELLED',
]);

export const animationAsyncStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'READY',
  'FAILED',
  'CANCELLED',
]);

export const createAnimationRequestSchema = z
  .object({
    storyWorkId: z.uuid(),
    sourceStoryVersionId: z.uuid(),
    title: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const animationSchema = z
  .object({
    id: z.uuid(),
    storyWorkId: z.uuid(),
    sourceStoryVersionId: z.uuid(),
    title: z.string().min(1).max(120),
    status: animationStatusSchema,
    scriptText: z.string().min(1).nullable(),
    scriptSourceAiJobId: z.uuid().nullable(),
    storyboardSourceAiJobId: z.uuid().nullable(),
    finalMediaAssetId: z.uuid().nullable(),
    costLimitConfigured: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.scriptText === null) !== (value.scriptSourceAiJobId === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['scriptText'],
        message: 'Script and source job must pair',
      });
    }
    if (value.status === 'READY' && value.finalMediaAssetId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['finalMediaAssetId'],
        message: 'READY animation requires final media',
      });
    }
  });

export const animationPlanningOperationSchema = z.enum(['SCRIPT', 'STORYBOARD']);

export const animationPlanningRequestSchema = z
  .object({ operation: animationPlanningOperationSchema })
  .strict();

export const animationScriptPlanSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    synopsis: z.string().trim().min(1).max(2000),
    script: z.string().trim().min(1).max(30000),
  })
  .strict();

export const animationCharacterRoleSchema = z.enum(['MAIN', 'SUPPORTING']);

export const animationCharacterDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    role: animationCharacterRoleSchema,
    description: z.string().trim().min(1).max(1000),
    visualPrompt: z.string().trim().min(1).max(2000),
  })
  .strict();

export const animationDialogueLineSchema = z
  .object({
    speaker: z.string().trim().min(1).max(80),
    text: z.string().trim().min(1).max(2000),
  })
  .strict();

export const animationSceneDraftSchema = z
  .object({
    scriptText: z.string().trim().min(1).max(10000),
    narration: z.string().trim().min(1).max(3000).nullable().optional(),
    dialogue: z.array(animationDialogueLineSchema).max(40).default([]),
    visualDescription: z.string().trim().min(1).max(3000),
    generationPrompt: z.string().trim().min(1).max(5000),
    plannedDurationMs: z.number().int().positive().max(600000),
  })
  .strict();

export const animationStoryboardPlanSchema = z
  .object({
    characters: z.array(animationCharacterDraftSchema).min(1).max(20),
    scenes: z.array(animationSceneDraftSchema).min(1).max(100),
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

export const animationCharacterSchema = animationCharacterDraftSchema.extend({
  id: z.uuid(),
  animationId: z.uuid(),
  consistencyKey: z.uuid(),
  referenceMediaAssetId: z.uuid().nullable(),
  sourceAiJobId: z.uuid(),
  sortOrder: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const usageMetadataSchema = z
  .object({
    inputUnits: z.number().nonnegative().optional(),
    outputUnits: z.number().nonnegative().optional(),
    durationSeconds: z.number().nonnegative().optional(),
  })
  .strict();

export const animationSceneGenerationSchema = z
  .object({
    id: z.uuid(),
    animationId: z.uuid(),
    sceneId: z.uuid(),
    revisionNumber: z.number().int().positive(),
    provider: z.string().min(1),
    model: z.string().min(1),
    status: animationAsyncStatusSchema,
    progressPercent: z.number().int().min(0).max(100),
    mediaAssetId: z.uuid().nullable(),
    errorCode: z.string().nullable(),
    usage: usageMetadataSchema.nullable(),
    costMetadata: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === 'READY' && value.mediaAssetId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['mediaAssetId'],
        message: 'READY generation requires media',
      });
    }
  });

export const animationSceneSchema = z
  .object({
    id: z.uuid(),
    animationId: z.uuid(),
    sceneNumber: z.number().int().positive(),
    scriptText: z.string().min(1),
    narration: z.string().nullable(),
    dialogue: z.array(animationDialogueLineSchema),
    visualDescription: z.string().min(1),
    generationPrompt: z.string().min(1),
    plannedDurationMs: z.number().int().positive(),
    sourcePlanningAiJobId: z.uuid(),
    generations: z.array(animationSceneGenerationSchema),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const animationCompositionInputSchema = z
  .object({
    sceneGenerationId: z.uuid(),
    sceneOrder: z.number().int().positive(),
  })
  .strict();

export const animationCompositionSchema = z
  .object({
    id: z.uuid(),
    animationId: z.uuid(),
    revisionNumber: z.number().int().positive(),
    status: animationAsyncStatusSchema,
    progressPercent: z.number().int().min(0).max(100),
    mediaAssetId: z.uuid().nullable(),
    errorCode: z.string().nullable(),
    usage: usageMetadataSchema.nullable(),
    costMetadata: z.record(z.string(), z.unknown()).nullable(),
    inputs: z.array(animationCompositionInputSchema).min(1),
    createdAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === 'READY' && value.mediaAssetId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['mediaAssetId'],
        message: 'READY composition requires media',
      });
    }
  });

export const animationDetailSchema = z
  .object({
    animation: animationSchema,
    characters: z.array(animationCharacterSchema),
    scenes: z.array(animationSceneSchema),
    compositions: z.array(animationCompositionSchema),
  })
  .strict();

export const animationListSchema = z.object({ animations: z.array(animationSchema) }).strict();

export const animationGenerationAcceptedSchema = z
  .object({
    animationId: z.uuid(),
    jobId: z.uuid(),
    operation: animationPlanningOperationSchema,
    status: z.literal('QUEUED'),
  })
  .strict();

export const applyAnimationJobRequestSchema = z.object({ jobId: z.uuid() }).strict();

export const animationJobStatusSchema = z
  .object({
    jobId: z.uuid(),
    animationId: z.uuid(),
    operation: animationPlanningOperationSchema,
    status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
    generatedText: z.string().nullable(),
    applied: z.boolean(),
    lastErrorCode: z.string().nullable(),
  })
  .strict();

export type AnimationStatus = z.infer<typeof animationStatusSchema>;
export type AnimationAsyncStatus = z.infer<typeof animationAsyncStatusSchema>;
export type CreateAnimationRequest = z.infer<typeof createAnimationRequestSchema>;
export type Animation = z.infer<typeof animationSchema>;
export type AnimationPlanningOperation = z.infer<typeof animationPlanningOperationSchema>;
export type AnimationPlanningRequest = z.infer<typeof animationPlanningRequestSchema>;
export type AnimationScriptPlan = z.infer<typeof animationScriptPlanSchema>;
export type AnimationStoryboardPlan = z.infer<typeof animationStoryboardPlanSchema>;
export type AnimationCharacter = z.infer<typeof animationCharacterSchema>;
export type AnimationScene = z.infer<typeof animationSceneSchema>;
export type AnimationSceneGeneration = z.infer<typeof animationSceneGenerationSchema>;
export type AnimationComposition = z.infer<typeof animationCompositionSchema>;
export type AnimationDetail = z.infer<typeof animationDetailSchema>;
export type AnimationList = z.infer<typeof animationListSchema>;
export type AnimationGenerationAccepted = z.infer<typeof animationGenerationAcceptedSchema>;
export type ApplyAnimationJobRequest = z.infer<typeof applyAnimationJobRequestSchema>;
export type AnimationJobStatus = z.infer<typeof animationJobStatusSchema>;
