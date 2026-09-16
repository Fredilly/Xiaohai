import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  animationDetailSchema,
  animationGenerationAcceptedSchema,
  animationJobStatusSchema,
  animationListSchema,
  animationPlanningRequestSchema,
  animationSceneGenerationAcceptedSchema,
  animationSchema,
  applyAnimationJobRequestSchema,
  createAnimationSceneGenerationRequestSchema,
  createAnimationRequestSchema,
} from '@xiaohai/contracts/animation';
import type { ConsumerSessionService } from '../auth/session.js';
import { AnimationError, type AnimationService } from './animation-service.js';

class AnimationAuthError extends Error {}

export function registerAnimationRoutes(
  app: FastifyInstance,
  options: {
    animation: AnimationService;
    consumerSessions: ConsumerSessionService;
  },
) {
  const consumer = (request: FastifyRequest) => {
    const raw = request.headers.authorization;
    if (!raw?.startsWith('Bearer ')) throw new AnimationAuthError();
    const claims = options.consumerSessions.verify(raw.slice(7));
    if (!claims) throw new AnimationAuthError();
    return claims.consumerUserId;
  };
  app.post('/api/v1/ai/animations', async (request, reply) => {
    const input = createAnimationRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      return reply
        .status(201)
        .send(
          animationSchema.parse(
            await options.animation.createAnimation(consumer(request), input.data),
          ),
        );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.get('/api/v1/ai/animations', async (request, reply) => {
    try {
      return animationListSchema.parse(await options.animation.listAnimations(consumer(request)));
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.get('/api/v1/ai/animations/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);
    try {
      return animationDetailSchema.parse(
        await options.animation.getAnimation(consumer(request), params.data.id),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.post('/api/v1/ai/animations/:id/generate', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    const input = animationPlanningRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      return reply
        .status(202)
        .send(
          animationGenerationAcceptedSchema.parse(
            await options.animation.generate(consumer(request), params.data.id, input.data),
          ),
        );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.post('/api/v1/ai/animations/:id/scenes/:sceneId/generations', async (request, reply) => {
    const params = z
      .object({
        id: z.uuid(),
        sceneId: z.uuid(),
      })
      .safeParse(request.params);

    const input = createAnimationSceneGenerationRequestSchema.safeParse(request.body ?? {});

    if (!params.success || !input.success) return invalid(reply, request.id);

    try {
      return reply
        .status(202)
        .send(
          animationSceneGenerationAcceptedSchema.parse(
            await options.animation.generateScene(
              consumer(request),
              params.data.id,
              params.data.sceneId,
            ),
          ),
        );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/ai/animations/jobs/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);
    try {
      return animationJobStatusSchema.parse(
        await options.animation.getJob(consumer(request), params.data.id),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.post('/api/v1/ai/animations/:id/apply', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    const input = applyAnimationJobRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      return animationDetailSchema.parse(
        await options.animation.applyJob(consumer(request), params.data.id, input.data.jobId),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
}

function invalid(reply: FastifyReply, requestId: string) {
  return reply
    .status(400)
    .send({ error: { code: 'INVALID_REQUEST', message: 'Invalid request', requestId } });
}
function fail(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  if (error instanceof AnimationAuthError) {
    status = 401;
    code = 'CONSUMER_AUTHENTICATION_REQUIRED';
    message = 'Consumer authentication required';
  } else if (error instanceof AnimationError) {
    code = error.code;
    if (error.code === 'NOT_FOUND') {
      status = 404;
      message = 'Animation resource not found';
    } else if (error.code === 'FEATURE_DISABLED') {
      status = 503;
      message = 'Animation AI is not enabled';
    } else {
      status = 409;
      message = 'Animation workflow state conflict';
    }
  }
  request.log.warn({ requestId: request.id, errorCode: code }, 'Animation AI request failed');
  return reply.status(status).send({ error: { code, message, requestId: request.id } });
}
