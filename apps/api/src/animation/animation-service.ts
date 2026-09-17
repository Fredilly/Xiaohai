import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  aiAnimations,
  aiJobs,
  aiProjects,
  animationCharacters,
  animationCompositionInputs,
  animationCompositions,
  animationSceneGenerations,
  animationScenes,
  mediaAssets,
  workVersions,
  works,
  type createDatabase,
} from '@xiaohai/db';
import {
  animationScriptPlanSchema,
  animationStoryboardPlanSchema,
  type AnimationDetail,
  type AnimationPlanningOperation,
  type AnimationPlanningRequest,
  type CreateAnimationRequest,
} from '@xiaohai/contracts/animation';
import type { AiQueue } from '../ai/ai-queue.js';
import type { VideoQueue } from './video-queue.js';
import type { CompositionQueue } from './composition-queue.js';

type Db = ReturnType<typeof createDatabase>['db'];

export type AnimationAiConfig = {
  enabled: boolean;
  provider: 'MOCK' | 'DEEPSEEK';
  model: string;
  maxAttempts: number;
  timeoutMs: number;
};

export type AnimationVideoConfig = {
  enabled: boolean;
  provider: 'MOCK';
  model: string;
};

export type AnimationWorkflowConfig = {
  compositionEnabled: boolean;
  maxGenerations: number;
  maxCompositions: number;
  maxPlannedDurationMs: number;
};

type AnimationLogger = { warn(bindings: Record<string, unknown>, message: string): void };
type AnimationContext = {
  kind: 'ANIMATION';
  animationId: string;
  operation: AnimationPlanningOperation;
};

export class AnimationError extends Error {
  constructor(
    readonly code:
      | 'FEATURE_DISABLED'
      | 'NOT_FOUND'
      | 'INVALID_SOURCE_VERSION'
      | 'INVALID_STATE'
      | 'JOB_NOT_READY'
      | 'INVALID_JOB_STATE'
      | 'INVALID_JOB_OUTPUT'
      | 'BUDGET_EXCEEDED',
  ) {
    super(code);
  }
}

export class AnimationService {
  constructor(
    private readonly db: Db,
    private readonly queue: AiQueue,
    private readonly config: AnimationAiConfig,
    private readonly logger?: AnimationLogger,
    private readonly videoQueue?: VideoQueue,
    private readonly videoConfig?: AnimationVideoConfig,
    private readonly compositionQueue?: CompositionQueue,
    private readonly workflowConfig: AnimationWorkflowConfig = {
      compositionEnabled: false,
      maxGenerations: 100,
      maxCompositions: 10,
      maxPlannedDurationMs: 600_000,
    },
  ) {}

  async createAnimation(consumerUserId: string, input: CreateAnimationRequest) {
    const source = await this.requireSource(
      consumerUserId,
      input.storyWorkId,
      input.sourceStoryVersionId,
    );
    const title = input.title ?? source.work.title;
    const created = await this.db.transaction(async (tx) => {
      const [project] = await tx
        .insert(aiProjects)
        .values({
          projectType: 'ANIMATION',
          title,
          createdByConsumerUserId: consumerUserId,
        })
        .returning();
      const [animation] = await tx
        .insert(aiAnimations)
        .values({
          consumerUserId,
          aiProjectId: project!.id,
          storyWorkId: source.work.id,
          sourceStoryVersionId: source.version.id,
          title,
          costLimitMetadata: {
            maxGenerations: this.workflowConfig.maxGenerations,
            maxCompositions: this.workflowConfig.maxCompositions,
            maxPlannedDurationMs: this.workflowConfig.maxPlannedDurationMs,
          },
        })
        .returning();
      return animation!;
    });
    return this.viewAnimation(created);
  }

  async listAnimations(consumerUserId: string) {
    const rows = await this.db
      .select()
      .from(aiAnimations)
      .where(eq(aiAnimations.consumerUserId, consumerUserId))
      .orderBy(desc(aiAnimations.updatedAt))
      .limit(100);
    return { animations: rows.map((row) => this.viewAnimation(row)) };
  }

  async getAnimation(consumerUserId: string, animationId: string): Promise<AnimationDetail> {
    const animation = await this.requireOwnedAnimation(consumerUserId, animationId);
    const characters = await this.db
      .select()
      .from(animationCharacters)
      .where(eq(animationCharacters.animationId, animation.id))
      .orderBy(asc(animationCharacters.sortOrder));
    const scenes = await this.db
      .select()
      .from(animationScenes)
      .where(eq(animationScenes.animationId, animation.id))
      .orderBy(asc(animationScenes.sceneNumber));
    const generations = await this.db
      .select()
      .from(animationSceneGenerations)
      .where(eq(animationSceneGenerations.animationId, animation.id))
      .orderBy(
        asc(animationSceneGenerations.sceneId),
        asc(animationSceneGenerations.revisionNumber),
      );
    const compositions = await this.db
      .select()
      .from(animationCompositions)
      .where(eq(animationCompositions.animationId, animation.id))
      .orderBy(asc(animationCompositions.revisionNumber));
    const compositionInputs = compositions.length
      ? await this.db
          .select()
          .from(animationCompositionInputs)
          .where(
            inArray(
              animationCompositionInputs.compositionId,
              compositions.map((row) => row.id),
            ),
          )
      : [];
    const [finalMedia] = animation.finalMediaAssetId
      ? await this.db
          .select()
          .from(mediaAssets)
          .where(eq(mediaAssets.id, animation.finalMediaAssetId))
      : [];
    return {
      animation: this.viewAnimation(animation),
      finalMedia: finalMedia
        ? {
            id: finalMedia.id,
            playbackUrl: finalMedia.playbackUrl,
            mimeType: finalMedia.mimeType,
            durationSeconds: finalMedia.durationSeconds,
          }
        : null,
      characters: characters.map((row) => this.viewCharacter(row)),
      scenes: scenes.map((row) => ({
        ...this.viewScene(row),
        generations: generations
          .filter((g) => g.sceneId === row.id)
          .map((g) => this.viewGeneration(g)),
      })),
      compositions: compositions.map((row) => ({
        ...this.viewComposition(row),
        inputs: compositionInputs
          .filter((input) => input.compositionId === row.id)
          .sort((a, b) => a.sceneOrder - b.sceneOrder)
          .map((input) => ({
            sceneGenerationId: input.sceneGenerationId,
            sceneOrder: input.sceneOrder,
          })),
      })),
    };
  }

  async generate(consumerUserId: string, animationId: string, input: AnimationPlanningRequest) {
    if (!this.config.enabled) throw new AnimationError('FEATURE_DISABLED');
    const animation = await this.requireOwnedAnimation(consumerUserId, animationId);
    const source = await this.requireSource(
      consumerUserId,
      animation.storyWorkId,
      animation.sourceStoryVersionId,
    );
    if (input.operation === 'SCRIPT') {
      if (animation.status !== 'DRAFT' || animation.scriptSourceAiJobId)
        throw new AnimationError('INVALID_STATE');
    } else if (animation.status !== 'SCRIPT_READY' || !animation.scriptText) {
      throw new AnimationError('INVALID_STATE');
    }
    const context: AnimationContext = {
      kind: 'ANIMATION',
      animationId: animation.id,
      operation: input.operation,
    };
    const job = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(aiAnimations)
        .where(
          and(eq(aiAnimations.id, animation.id), eq(aiAnimations.consumerUserId, consumerUserId)),
        )
        .for('update');
      if (!locked) throw new AnimationError('NOT_FOUND');
      if (input.operation === 'SCRIPT') {
        if (locked.status !== 'DRAFT' || locked.scriptSourceAiJobId)
          throw new AnimationError('INVALID_STATE');
      } else if (locked.status !== 'SCRIPT_READY' || !locked.scriptText) {
        throw new AnimationError('INVALID_STATE');
      }
      const [active] = await tx
        .select({ id: aiJobs.id })
        .from(aiJobs)
        .where(
          and(
            eq(aiJobs.projectId, locked.aiProjectId),
            eq(aiJobs.jobType, this.jobType(input.operation)),
            inArray(aiJobs.status, ['QUEUED', 'RUNNING']),
          ),
        )
        .limit(1);
      if (active) throw new AnimationError('INVALID_STATE');
      const [created] = await tx
        .insert(aiJobs)
        .values({
          projectId: locked.aiProjectId,
          jobType: this.jobType(input.operation),
          provider: this.config.provider,
          model: this.config.model,
          input: {
            prompt: this.buildPrompt(animation, source.work, source.version, input.operation),
            context,
          },
          maxAttempts: this.config.maxAttempts,
          timeoutMs: this.config.timeoutMs,
        })
        .returning();
      return created!;
    });
    try {
      await this.queue.notify(job.id);
    } catch {
      this.logger?.warn(
        { event: 'ANIMATION_AI_QUEUE_NOTIFY_FAILED', jobId: job.id, animationId: animation.id },
        'Animation AI queue notification failed; PostgreSQL polling will recover the job',
      );
    }
    return {
      animationId: animation.id,
      jobId: job.id,
      operation: input.operation,
      status: 'QUEUED' as const,
    };
  }

  async generateScene(consumerUserId: string, animationId: string, sceneId: string) {
    const videoConfig = this.videoConfig;
    const videoQueue = this.videoQueue;

    if (!videoConfig?.enabled || !videoQueue) {
      throw new AnimationError('FEATURE_DISABLED');
    }

    const generation = await this.db.transaction(async (tx) => {
      // Serialize animation-level budget, active-task and revision decisions on one aggregate row.
      // Concurrent generation requests for different scenes must still share the same animation budget.
      const [animation] = await tx
        .select()
        .from(aiAnimations)
        .where(
          and(eq(aiAnimations.id, animationId), eq(aiAnimations.consumerUserId, consumerUserId)),
        )
        .for('update');

      if (!animation) throw new AnimationError('NOT_FOUND');

      if (animation.status !== 'STORYBOARD_READY' && animation.status !== 'GENERATING') {
        throw new AnimationError('INVALID_STATE');
      }

      const [scene] = await tx
        .select()
        .from(animationScenes)
        .where(and(eq(animationScenes.id, sceneId), eq(animationScenes.animationId, animation.id)))
        .for('update');

      if (!scene) throw new AnimationError('NOT_FOUND');

      const [counts] = await tx
        .select({ total: sql<number>`count(*)` })
        .from(animationSceneGenerations)
        .where(eq(animationSceneGenerations.animationId, animation.id));
      const [duration] = await tx
        .select({ total: sql<number>`coalesce(sum(${animationScenes.plannedDurationMs}), 0)` })
        .from(animationScenes)
        .where(eq(animationScenes.animationId, animation.id));
      if (
        Number(counts?.total ?? 0) >= this.workflowConfig.maxGenerations ||
        Number(duration?.total ?? 0) > this.workflowConfig.maxPlannedDurationMs
      )
        throw new AnimationError('BUDGET_EXCEEDED');

      const [active] = await tx
        .select({ id: animationSceneGenerations.id })
        .from(animationSceneGenerations)
        .where(
          and(
            eq(animationSceneGenerations.sceneId, scene.id),
            inArray(animationSceneGenerations.status, ['QUEUED', 'RUNNING']),
          ),
        )
        .limit(1);

      if (active) throw new AnimationError('INVALID_STATE');

      const [revision] = await tx
        .select({
          value: sql<number>`coalesce(max(${animationSceneGenerations.revisionNumber}), 0) + 1`,
        })
        .from(animationSceneGenerations)
        .where(eq(animationSceneGenerations.sceneId, scene.id));

      const [created] = await tx
        .insert(animationSceneGenerations)
        .values({
          animationId: animation.id,
          sceneId: scene.id,
          revisionNumber: Number(revision!.value),
          provider: videoConfig.provider,
          model: videoConfig.model,
        })
        .returning();

      if (animation.status === 'STORYBOARD_READY') {
        await tx
          .update(aiAnimations)
          .set({
            status: 'GENERATING',
            updatedAt: new Date(),
          })
          .where(eq(aiAnimations.id, animation.id));
      }

      return created!;
    });

    try {
      await videoQueue.notify(generation.id);
    } catch {
      this.logger?.warn(
        {
          event: 'ANIMATION_VIDEO_QUEUE_NOTIFY_FAILED',
          generationId: generation.id,
          animationId,
          sceneId,
        },
        'Animation video queue notification failed; PostgreSQL polling will recover the generation',
      );
    }

    return {
      animationId,
      sceneId,
      generationId: generation.id,
      revisionNumber: generation.revisionNumber,
      status: 'QUEUED' as const,
    };
  }

  async createComposition(consumerUserId: string, animationId: string, generationIds: string[]) {
    if (!this.workflowConfig.compositionEnabled || !this.compositionQueue)
      throw new AnimationError('FEATURE_DISABLED');
    const composition = await this.db.transaction(async (tx) => {
      // Serialize composition budget, active-task and revision decisions on the animation aggregate.
      // The row lock is intentionally acquired before any count or next-revision calculation.
      const [animation] = await tx
        .select()
        .from(aiAnimations)
        .where(
          and(eq(aiAnimations.id, animationId), eq(aiAnimations.consumerUserId, consumerUserId)),
        )
        .for('update');
      if (!animation) throw new AnimationError('NOT_FOUND');
      if (!['GENERATING', 'READY'].includes(animation.status))
        throw new AnimationError('INVALID_STATE');
      const [active] = await tx
        .select({ id: animationCompositions.id })
        .from(animationCompositions)
        .where(
          and(
            eq(animationCompositions.animationId, animation.id),
            inArray(animationCompositions.status, ['QUEUED', 'RUNNING']),
          ),
        )
        .limit(1);
      if (active) throw new AnimationError('INVALID_STATE');
      const scenes = await tx
        .select()
        .from(animationScenes)
        .where(eq(animationScenes.animationId, animation.id))
        .orderBy(asc(animationScenes.sceneNumber));
      const generations = await tx
        .select()
        .from(animationSceneGenerations)
        .where(
          and(
            eq(animationSceneGenerations.animationId, animation.id),
            inArray(animationSceneGenerations.id, generationIds),
          ),
        );
      if (
        !scenes.length ||
        generations.length !== scenes.length ||
        new Set(generationIds).size !== generationIds.length
      )
        throw new AnimationError('INVALID_STATE');
      const ordered = scenes.map((scene) =>
        generations.find((generation) => generation.sceneId === scene.id),
      );
      if (
        ordered.some(
          (generation) => !generation || generation.status !== 'READY' || !generation.mediaAssetId,
        )
      )
        throw new AnimationError('INVALID_STATE');
      const [count] = await tx
        .select({ total: sql<number>`count(*)` })
        .from(animationCompositions)
        .where(eq(animationCompositions.animationId, animation.id));
      if (Number(count?.total ?? 0) >= this.workflowConfig.maxCompositions)
        throw new AnimationError('BUDGET_EXCEEDED');
      const [latest] = await tx
        .select({ revisionNumber: animationCompositions.revisionNumber })
        .from(animationCompositions)
        .where(eq(animationCompositions.animationId, animation.id))
        .orderBy(desc(animationCompositions.revisionNumber))
        .limit(1);
      const [created] = await tx
        .insert(animationCompositions)
        .values({
          animationId: animation.id,
          revisionNumber: (latest?.revisionNumber ?? 0) + 1,
          costMetadata: { source: 'SERVER_BUDGET', costUnits: scenes.length },
        })
        .returning();
      await tx.insert(animationCompositionInputs).values(
        ordered.map((generation, index) => ({
          animationId: animation.id,
          compositionId: created!.id,
          sceneGenerationId: generation!.id,
          sceneOrder: scenes[index]!.sceneNumber,
        })),
      );
      await tx
        .update(aiAnimations)
        .set({ status: 'COMPOSING', updatedAt: new Date() })
        .where(eq(aiAnimations.id, animation.id));
      return created!;
    });
    try {
      await this.compositionQueue.notify(composition.id);
    } catch {
      this.logger?.warn(
        {
          event: 'ANIMATION_COMPOSITION_QUEUE_NOTIFY_FAILED',
          compositionId: composition.id,
          animationId,
        },
        'Animation composition queue notification failed; PostgreSQL polling will recover the composition',
      );
    }
    return {
      animationId,
      compositionId: composition.id,
      revisionNumber: composition.revisionNumber,
      status: 'QUEUED' as const,
    };
  }

  async getJob(consumerUserId: string, jobId: string) {
    const { job, animation, context } = await this.requireOwnedJob(consumerUserId, jobId);
    const applied =
      context.operation === 'SCRIPT'
        ? animation.scriptSourceAiJobId === job.id
        : animation.storyboardSourceAiJobId === job.id;
    return {
      jobId: job.id,
      animationId: animation.id,
      operation: context.operation,
      status: job.status as 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED',
      generatedText:
        job.status === 'SUCCEEDED' && typeof job.result?.text === 'string' ? job.result.text : null,
      applied,
      lastErrorCode: job.lastErrorCode ?? null,
    };
  }

  async applyJob(
    consumerUserId: string,
    animationId: string,
    jobId: string,
  ): Promise<AnimationDetail> {
    await this.db.transaction(async (tx) => {
      const [animation] = await tx
        .select()
        .from(aiAnimations)
        .where(
          and(eq(aiAnimations.id, animationId), eq(aiAnimations.consumerUserId, consumerUserId)),
        )
        .for('update');
      if (!animation) throw new AnimationError('NOT_FOUND');
      const [job] = await tx
        .select()
        .from(aiJobs)
        .where(and(eq(aiJobs.id, jobId), eq(aiJobs.projectId, animation.aiProjectId)));
      if (!job) throw new AnimationError('NOT_FOUND');
      const context = this.readContext(job.input.context);
      if (context.animationId !== animation.id || job.jobType !== this.jobType(context.operation))
        throw new AnimationError('INVALID_JOB_STATE');
      if (context.operation === 'SCRIPT' && animation.scriptSourceAiJobId === job.id) return;
      if (context.operation === 'STORYBOARD' && animation.storyboardSourceAiJobId === job.id)
        return;
      if (job.status !== 'SUCCEEDED' || typeof job.result?.text !== 'string')
        throw new AnimationError('JOB_NOT_READY');

      if (context.operation === 'SCRIPT') {
        if (animation.status !== 'DRAFT' || animation.scriptSourceAiJobId)
          throw new AnimationError('INVALID_STATE');
        const parsed = animationScriptPlanSchema.safeParse(this.parseJson(job.result.text));
        if (!parsed.success) throw new AnimationError('INVALID_JOB_OUTPUT');
        await tx
          .update(aiAnimations)
          .set({
            title: parsed.data.title,
            scriptText: parsed.data.script,
            scriptSourceAiJobId: job.id,
            status: 'SCRIPT_READY',
            updatedAt: new Date(),
          })
          .where(eq(aiAnimations.id, animation.id));
        return;
      }

      if (animation.status !== 'SCRIPT_READY' || !animation.scriptSourceAiJobId)
        throw new AnimationError('INVALID_STATE');
      const parsed = animationStoryboardPlanSchema.safeParse(this.parseJson(job.result.text));
      if (!parsed.success) throw new AnimationError('INVALID_JOB_OUTPUT');
      const [existingCharacter] = await tx
        .select({ id: animationCharacters.id })
        .from(animationCharacters)
        .where(eq(animationCharacters.animationId, animation.id))
        .limit(1);
      const [existingScene] = await tx
        .select({ id: animationScenes.id })
        .from(animationScenes)
        .where(eq(animationScenes.animationId, animation.id))
        .limit(1);
      if (existingCharacter || existingScene || animation.storyboardSourceAiJobId)
        throw new AnimationError('INVALID_STATE');
      await tx.insert(animationCharacters).values(
        parsed.data.characters.map((character, index) => ({
          animationId: animation.id,
          ...character,
          sourceAiJobId: job.id,
          sortOrder: index,
        })),
      );
      await tx.insert(animationScenes).values(
        parsed.data.scenes.map((scene, index) => ({
          animationId: animation.id,
          sceneNumber: index + 1,
          scriptText: scene.scriptText,
          narration: scene.narration ?? null,
          dialogue: scene.dialogue,
          visualDescription: scene.visualDescription,
          generationPrompt: scene.generationPrompt,
          plannedDurationMs: scene.plannedDurationMs,
          sourcePlanningAiJobId: job.id,
        })),
      );
      await tx
        .update(aiAnimations)
        .set({ storyboardSourceAiJobId: job.id, status: 'STORYBOARD_READY', updatedAt: new Date() })
        .where(eq(aiAnimations.id, animation.id));
    });
    return this.getAnimation(consumerUserId, animationId);
  }

  private async requireOwnedAnimation(consumerUserId: string, animationId: string) {
    const [row] = await this.db
      .select()
      .from(aiAnimations)
      .where(
        and(eq(aiAnimations.id, animationId), eq(aiAnimations.consumerUserId, consumerUserId)),
      );
    if (!row) throw new AnimationError('NOT_FOUND');
    return row;
  }
  private async requireSource(consumerUserId: string, workId: string, versionId: string) {
    const [source] = await this.db
      .select({ work: works, version: workVersions })
      .from(works)
      .innerJoin(workVersions, eq(workVersions.workId, works.id))
      .where(
        and(
          eq(works.id, workId),
          eq(works.consumerUserId, consumerUserId),
          eq(workVersions.id, versionId),
        ),
      );
    if (!source || source.version.contentKind !== 'BODY')
      throw new AnimationError('INVALID_SOURCE_VERSION');
    return source;
  }
  private async requireOwnedJob(consumerUserId: string, jobId: string) {
    const [row] = await this.db
      .select({ job: aiJobs, animation: aiAnimations })
      .from(aiJobs)
      .innerJoin(aiAnimations, eq(aiAnimations.aiProjectId, aiJobs.projectId))
      .where(and(eq(aiJobs.id, jobId), eq(aiAnimations.consumerUserId, consumerUserId)));
    if (!row) throw new AnimationError('NOT_FOUND');
    const context = this.readContext(row.job.input.context);
    if (
      context.animationId !== row.animation.id ||
      row.job.jobType !== this.jobType(context.operation)
    )
      throw new AnimationError('INVALID_JOB_STATE');
    return { ...row, context };
  }
  private readContext(value: unknown): AnimationContext {
    if (!value || typeof value !== 'object') throw new AnimationError('INVALID_JOB_STATE');
    const context = value as Partial<AnimationContext>;
    if (
      context.kind !== 'ANIMATION' ||
      typeof context.animationId !== 'string' ||
      (context.operation !== 'SCRIPT' && context.operation !== 'STORYBOARD')
    )
      throw new AnimationError('INVALID_JOB_STATE');
    return context as AnimationContext;
  }
  private jobType(operation: AnimationPlanningOperation) {
    return `ANIMATION_${operation}` as const;
  }
  private parseJson(text: string): unknown {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    try {
      return JSON.parse(fenced?.[1] ?? trimmed);
    } catch {
      throw new AnimationError('INVALID_JOB_OUTPUT');
    }
  }
  private buildPrompt(
    animation: typeof aiAnimations.$inferSelect,
    work: typeof works.$inferSelect,
    version: typeof workVersions.$inferSelect,
    operation: AnimationPlanningOperation,
  ) {
    const common = [
      `XIAOHAI_TASK=ANIMATION_${operation}`,
      '你是小海童话的儿童动画文本策划助手。',
      '只输出合法 JSON，不输出 Markdown、解释、前言或模型身份。',
      `动画标题：${animation.title}`,
      `目标年龄：${work.ageRange}`,
      `主题：${work.theme}`,
      `风格：${work.style}`,
      '内容必须适龄、温和，并忠实于参考故事。',
      '参考故事正文：',
      version.content,
    ];
    if (operation === 'SCRIPT')
      return [
        ...common,
        '请生成适合后续分镜的完整动画文本脚本。',
        '输出格式：{"title":"标题","synopsis":"概要","script":"完整脚本"}',
      ].join('\n\n');
    return [
      ...common,
      '已应用动画脚本：',
      animation.scriptText!,
      '请输出角色设定和按播放顺序排列的场景。visualPrompt 描述稳定外观；plannedDurationMs 为正整数；generationPrompt 用于未来服务端视频生成。',
      '输出格式：{"characters":[{"name":"角色名","role":"MAIN","description":"说明","visualPrompt":"稳定视觉描述"}],"scenes":[{"scriptText":"场景脚本","narration":null,"dialogue":[{"speaker":"角色","text":"台词"}],"visualDescription":"场景说明","generationPrompt":"生成提示","plannedDurationMs":5000}]}',
    ].join('\n\n');
  }
  private viewAnimation(row: typeof aiAnimations.$inferSelect) {
    return {
      id: row.id,
      storyWorkId: row.storyWorkId,
      sourceStoryVersionId: row.sourceStoryVersionId,
      title: row.title,
      status: row.status as
        | 'DRAFT'
        | 'SCRIPT_READY'
        | 'STORYBOARD_READY'
        | 'GENERATING'
        | 'COMPOSING'
        | 'READY'
        | 'FAILED'
        | 'CANCELLED',
      scriptText: row.scriptText,
      scriptSourceAiJobId: row.scriptSourceAiJobId,
      storyboardSourceAiJobId: row.storyboardSourceAiJobId,
      finalMediaAssetId: row.finalMediaAssetId,
      costLimitConfigured: row.costLimitMetadata !== null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  private viewCharacter(row: typeof animationCharacters.$inferSelect) {
    return {
      ...row,
      role: row.role as 'MAIN' | 'SUPPORTING',
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  private viewScene(row: typeof animationScenes.$inferSelect) {
    return {
      ...row,
      dialogue: row.dialogue,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  private viewGeneration(row: typeof animationSceneGenerations.$inferSelect) {
    return {
      ...row,
      status: row.status as 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'CANCELLED',
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  private viewComposition(row: typeof animationCompositions.$inferSelect) {
    return {
      ...row,
      status: row.status as 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'CANCELLED',
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
