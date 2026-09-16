import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createStoryWorkRequestSchema,
  saveStoryVersionRequestSchema,
  storyGenerateRequestSchema,
  storyGenerationAcceptedSchema,
  storyJobStatusSchema,
  storyVersionSchema,
  storyWorkDetailSchema,
  storyWorkListSchema,
  storyWorkSchema,
} from '@xiaohai/contracts/story';
import type { ConsumerSessionService } from '../auth/session.js';
import { StoryError, type StoryService } from './story-service.js';

class StoryAuthError extends Error {}

export function registerStoryRoutes(
  app: FastifyInstance,
  options: {
    story: StoryService;
    consumerSessions: ConsumerSessionService;
  },
) {
  const consumer = (request: FastifyRequest) => {
    const raw = request.headers.authorization;
    if (!raw?.startsWith('Bearer ')) throw new StoryAuthError();

    const claims = options.consumerSessions.verify(raw.slice(7));
    if (!claims) throw new StoryAuthError();

    return claims.consumerUserId;
  };

  app.post('/api/v1/ai/story/works', async (request, reply) => {
    const input = createStoryWorkRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);

    try {
      return reply
        .status(201)
        .send(storyWorkSchema.parse(await options.story.createWork(consumer(request), input.data)));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/ai/story/works', async (request, reply) => {
    try {
      return storyWorkListSchema.parse(await options.story.listWorks(consumer(request)));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/ai/story/works/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);

    try {
      return storyWorkDetailSchema.parse(
        await options.story.getWork(consumer(request), params.data.id),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/ai/story/works/:id/generate', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    const input = storyGenerateRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);

    try {
      return reply
        .status(202)
        .send(
          storyGenerationAcceptedSchema.parse(
            await options.story.generate(consumer(request), params.data.id, input.data),
          ),
        );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/ai/story/jobs/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);

    try {
      return storyJobStatusSchema.parse(
        await options.story.getJob(consumer(request), params.data.id),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/ai/story/works/:id/versions', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    const input = saveStoryVersionRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);

    try {
      return storyVersionSchema.parse(
        await options.story.saveVersion(consumer(request), params.data.id, input.data.jobId),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
}

function invalid(reply: FastifyReply, requestId: string) {
  return reply.status(400).send({
    error: {
      code: 'INVALID_REQUEST',
      message: 'Invalid request',
      requestId,
    },
  });
}

function fail(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Internal server error';

  if (error instanceof StoryAuthError) {
    status = 401;
    code = 'CONSUMER_AUTHENTICATION_REQUIRED';
    message = 'Consumer authentication required';
  } else if (error instanceof StoryError) {
    code = error.code;

    if (error.code === 'NOT_FOUND') {
      status = 404;
      message = 'Story resource not found';
    } else if (error.code === 'FEATURE_DISABLED') {
      status = 503;
      message = 'Story AI is not enabled';
    } else {
      status = 409;
      message = 'Story workflow state conflict';
    }
  }

  request.log.warn({ requestId: request.id, errorCode: code }, 'Story AI request failed');

  return reply.status(status).send({ error: { code, message, requestId: request.id } });
}
