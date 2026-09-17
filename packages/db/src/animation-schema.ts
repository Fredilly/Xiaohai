import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { aiJobs, aiProjects } from './ai-schema.js';
import { mediaAssets } from './content-schema.js';
import { consumerUsers } from './schema.js';
import { works, workVersions } from './works-schema.js';

export type AnimationUsageMetadata = {
  inputUnits?: number;
  outputUnits?: number;
  durationSeconds?: number;
};

export type AnimationDialogueLine = {
  speaker: string;
  text: string;
};

export const aiAnimations = pgTable(
  'ai_animations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    consumerUserId: uuid('consumer_user_id')
      .notNull()
      .references(() => consumerUsers.id, { onDelete: 'restrict' }),
    aiProjectId: uuid('ai_project_id').notNull(),
    storyWorkId: uuid('story_work_id').notNull(),
    sourceStoryVersionId: uuid('source_story_version_id').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('DRAFT'),
    scriptText: text('script_text'),
    scriptSourceAiJobId: uuid('script_source_ai_job_id'),
    storyboardSourceAiJobId: uuid('storyboard_source_ai_job_id'),
    finalMediaAssetId: uuid('final_media_asset_id').references(() => mediaAssets.id, {
      onDelete: 'restrict',
    }),
    costLimitMetadata: jsonb('cost_limit_metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ai_animations_ai_project_unique').on(t.aiProjectId),
    uniqueIndex('ai_animations_script_job_unique').on(t.scriptSourceAiJobId),
    uniqueIndex('ai_animations_storyboard_job_unique').on(t.storyboardSourceAiJobId),
    index('ai_animations_consumer_updated_idx').on(t.consumerUserId, t.updatedAt),
    index('ai_animations_story_source_idx').on(t.storyWorkId, t.sourceStoryVersionId),
    foreignKey({
      columns: [t.aiProjectId, t.consumerUserId],
      foreignColumns: [aiProjects.id, aiProjects.createdByConsumerUserId],
      name: 'ai_animations_project_owner_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.storyWorkId, t.consumerUserId],
      foreignColumns: [works.id, works.consumerUserId],
      name: 'ai_animations_story_owner_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.sourceStoryVersionId, t.storyWorkId],
      foreignColumns: [workVersions.id, workVersions.workId],
      name: 'ai_animations_story_version_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.scriptSourceAiJobId, t.aiProjectId],
      foreignColumns: [aiJobs.id, aiJobs.projectId],
      name: 'ai_animations_script_job_project_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.storyboardSourceAiJobId, t.aiProjectId],
      foreignColumns: [aiJobs.id, aiJobs.projectId],
      name: 'ai_animations_storyboard_job_project_fk',
    }).onDelete('restrict'),
    check(
      'ai_animations_status_check',
      sql`${t.status} in ('DRAFT','SCRIPT_READY','STORYBOARD_READY','GENERATING','COMPOSING','READY','FAILED','CANCELLED')`,
    ),
    check('ai_animations_title_check', sql`char_length(btrim(${t.title})) between 1 and 120`),
    check(
      'ai_animations_script_pair_check',
      sql`(${t.scriptText} is null and ${t.scriptSourceAiJobId} is null)
        or (${t.scriptText} is not null and ${t.scriptSourceAiJobId} is not null)`,
    ),
    check(
      'ai_animations_storyboard_after_script_check',
      sql`${t.storyboardSourceAiJobId} is null or ${t.scriptSourceAiJobId} is not null`,
    ),
    check(
      'ai_animations_ready_asset_check',
      sql`${t.status} <> 'READY' or ${t.finalMediaAssetId} is not null`,
    ),
  ],
);

export const animationCharacters = pgTable(
  'animation_characters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    animationId: uuid('animation_id')
      .notNull()
      .references(() => aiAnimations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: text('role').notNull().default('MAIN'),
    description: text('description').notNull(),
    visualPrompt: text('visual_prompt').notNull(),
    consistencyKey: uuid('consistency_key').notNull().defaultRandom(),
    referenceMediaAssetId: uuid('reference_media_asset_id').references(() => mediaAssets.id, {
      onDelete: 'restrict',
    }),
    sourceAiJobId: uuid('source_ai_job_id')
      .notNull()
      .references(() => aiJobs.id, { onDelete: 'restrict' }),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('animation_characters_animation_name_unique').on(t.animationId, t.name),
    uniqueIndex('animation_characters_animation_sort_unique').on(t.animationId, t.sortOrder),
    index('animation_characters_animation_idx').on(t.animationId),
    check('animation_characters_role_check', sql`${t.role} in ('MAIN','SUPPORTING')`),
    check('animation_characters_sort_check', sql`${t.sortOrder} >= 0`),
    check('animation_characters_name_check', sql`char_length(btrim(${t.name})) > 0`),
    check(
      'animation_characters_visual_prompt_check',
      sql`char_length(btrim(${t.visualPrompt})) > 0`,
    ),
  ],
);

export const animationScenes = pgTable(
  'animation_scenes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    animationId: uuid('animation_id')
      .notNull()
      .references(() => aiAnimations.id, { onDelete: 'cascade' }),
    sceneNumber: integer('scene_number').notNull(),
    scriptText: text('script_text').notNull(),
    narration: text('narration'),
    dialogue: jsonb('dialogue').$type<AnimationDialogueLine[]>().notNull().default([]),
    visualDescription: text('visual_description').notNull(),
    generationPrompt: text('generation_prompt').notNull(),
    plannedDurationMs: integer('planned_duration_ms').notNull(),
    sourcePlanningAiJobId: uuid('source_planning_ai_job_id')
      .notNull()
      .references(() => aiJobs.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('animation_scenes_animation_number_unique').on(t.animationId, t.sceneNumber),
    uniqueIndex('animation_scenes_id_animation_unique').on(t.id, t.animationId),
    index('animation_scenes_animation_idx').on(t.animationId, t.sceneNumber),
    check('animation_scenes_number_check', sql`${t.sceneNumber} > 0`),
    check('animation_scenes_duration_check', sql`${t.plannedDurationMs} > 0`),
    check('animation_scenes_script_check', sql`char_length(btrim(${t.scriptText})) > 0`),
    check('animation_scenes_visual_check', sql`char_length(btrim(${t.visualDescription})) > 0`),
    check('animation_scenes_prompt_check', sql`char_length(btrim(${t.generationPrompt})) > 0`),
    check('animation_scenes_dialogue_check', sql`jsonb_typeof(${t.dialogue}) = 'array'`),
  ],
);

export const animationSceneGenerations = pgTable(
  'animation_scene_generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    animationId: uuid('animation_id')
      .notNull()
      .references(() => aiAnimations.id, { onDelete: 'cascade' }),
    sceneId: uuid('scene_id').notNull(),
    revisionNumber: integer('revision_number').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    status: text('status').notNull().default('QUEUED'),
    progressPercent: integer('progress_percent').notNull().default(0),
    mediaAssetId: uuid('media_asset_id').references(() => mediaAssets.id, {
      onDelete: 'restrict',
    }),
    errorCode: text('error_code'),
    usage: jsonb('usage').$type<AnimationUsageMetadata>(),
    costMetadata: jsonb('cost_metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('animation_scene_generations_scene_revision_unique').on(
      t.sceneId,
      t.revisionNumber,
    ),
    uniqueIndex('animation_scene_generations_id_animation_unique').on(t.id, t.animationId),
    foreignKey({
      columns: [t.sceneId, t.animationId],
      foreignColumns: [animationScenes.id, animationScenes.animationId],
      name: 'animation_scene_generations_scene_animation_fk',
    }).onDelete('cascade'),
    index('animation_scene_generations_claim_idx').on(t.status, t.createdAt),
    index('animation_scene_generations_scene_status_idx').on(t.sceneId, t.status),
    check('animation_scene_generations_revision_check', sql`${t.revisionNumber} > 0`),
    check('animation_scene_generations_provider_check', sql`char_length(btrim(${t.provider})) > 0`),
    check('animation_scene_generations_model_check', sql`char_length(btrim(${t.model})) > 0`),
    check(
      'animation_scene_generations_status_check',
      sql`${t.status} in ('QUEUED','RUNNING','READY','FAILED','CANCELLED')`,
    ),
    check(
      'animation_scene_generations_progress_check',
      sql`${t.progressPercent} between 0 and 100`,
    ),
    check(
      'animation_scene_generations_ready_asset_check',
      sql`${t.status} <> 'READY' or ${t.mediaAssetId} is not null`,
    ),
  ],
);

export const animationCompositions = pgTable(
  'animation_compositions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    animationId: uuid('animation_id')
      .notNull()
      .references(() => aiAnimations.id, { onDelete: 'cascade' }),
    revisionNumber: integer('revision_number').notNull(),
    status: text('status').notNull().default('QUEUED'),
    progressPercent: integer('progress_percent').notNull().default(0),
    mediaAssetId: uuid('media_asset_id').references(() => mediaAssets.id, {
      onDelete: 'restrict',
    }),
    errorCode: text('error_code'),
    usage: jsonb('usage').$type<AnimationUsageMetadata>(),
    costMetadata: jsonb('cost_metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('animation_compositions_animation_revision_unique').on(
      t.animationId,
      t.revisionNumber,
    ),
    uniqueIndex('animation_compositions_id_animation_unique').on(t.id, t.animationId),
    index('animation_compositions_animation_status_idx').on(t.animationId, t.status),
    check('animation_compositions_revision_check', sql`${t.revisionNumber} > 0`),
    check(
      'animation_compositions_status_check',
      sql`${t.status} in ('QUEUED','RUNNING','READY','FAILED','CANCELLED')`,
    ),
    check('animation_compositions_progress_check', sql`${t.progressPercent} between 0 and 100`),
    check(
      'animation_compositions_ready_asset_check',
      sql`${t.status} <> 'READY' or ${t.mediaAssetId} is not null`,
    ),
  ],
);

export const animationCompositionInputs = pgTable(
  'animation_composition_inputs',
  {
    animationId: uuid('animation_id')
      .notNull()
      .references(() => aiAnimations.id, { onDelete: 'cascade' }),
    compositionId: uuid('composition_id').notNull(),
    sceneGenerationId: uuid('scene_generation_id').notNull(),
    sceneOrder: integer('scene_order').notNull(),
  },
  (t) => [
    primaryKey({
      name: 'animation_composition_inputs_pk',
      columns: [t.compositionId, t.sceneGenerationId],
    }),
    uniqueIndex('animation_composition_inputs_order_unique').on(t.compositionId, t.sceneOrder),
    foreignKey({
      columns: [t.compositionId, t.animationId],
      foreignColumns: [animationCompositions.id, animationCompositions.animationId],
      name: 'animation_composition_inputs_composition_animation_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.sceneGenerationId, t.animationId],
      foreignColumns: [animationSceneGenerations.id, animationSceneGenerations.animationId],
      name: 'animation_composition_inputs_generation_animation_fk',
    }).onDelete('restrict'),
    check('animation_composition_inputs_order_check', sql`${t.sceneOrder} > 0`),
  ],
);
