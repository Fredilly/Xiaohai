import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  applyPictureBookJobRequestSchema,
  createPictureBookRequestSchema,
  pictureBookDetailSchema,
  pictureBookGenerateRequestSchema,
  pictureBookGenerationAcceptedSchema,
  pictureBookJobStatusSchema,
  pictureBookListSchema,
  pictureBookSchema,
} from '@xiaohai/contracts/picture-book';
import type { ConsumerSessionService } from '../auth/session.js';
import { PictureBookError, type PictureBookService } from './picture-book-service.js';

class PictureBookAuthError extends Error {}

export function registerPictureBookRoutes(
  app: FastifyInstance,
  options: {
    pictureBook: PictureBookService;
    consumerSessions: ConsumerSessionService;
  },
) {
  const consumer = (request: FastifyRequest) => {
    const raw = request.headers.authorization;
    if (!raw?.startsWith('Bearer ')) throw new PictureBookAuthError();

    const claims = options.consumerSessions.verify(raw.slice(7));
    if (!claims) throw new PictureBookAuthError();

    return claims.consumerUserId;
  };

  app.post('/api/v1/ai/picture-books', async (request, reply) => {
    const input = createPictureBookRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);

    try {
      return reply
        .status(201)
        .send(
          pictureBookSchema.parse(
            await options.pictureBook.createPictureBook(consumer(request), input.data),
          ),
        );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/ai/picture-books', async (request, reply) => {
    try {
      return pictureBookListSchema.parse(
        await options.pictureBook.listPictureBooks(consumer(request)),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/ai/picture-books/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);

    try {
      return pictureBookDetailSchema.parse(
        await options.pictureBook.getPictureBook(consumer(request), params.data.id),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/ai/picture-books/:id/generate', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    const input = pictureBookGenerateRequestSchema.safeParse(request.body);

    if (!params.success || !input.success) {
      return invalid(reply, request.id);
    }

    try {
      return reply
        .status(202)
        .send(
          pictureBookGenerationAcceptedSchema.parse(
            await options.pictureBook.generate(consumer(request), params.data.id, input.data),
          ),
        );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/ai/picture-books/jobs/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);

    try {
      return pictureBookJobStatusSchema.parse(
        await options.pictureBook.getJob(consumer(request), params.data.id),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/ai/picture-books/:id/apply', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    const input = applyPictureBookJobRequestSchema.safeParse(request.body);

    if (!params.success || !input.success) {
      return invalid(reply, request.id);
    }

    try {
      return pictureBookDetailSchema.parse(
        await options.pictureBook.applyJob(consumer(request), params.data.id, input.data.jobId),
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

  if (error instanceof PictureBookAuthError) {
    status = 401;
    code = 'CONSUMER_AUTHENTICATION_REQUIRED';
    message = 'Consumer authentication required';
  } else if (error instanceof PictureBookError) {
    code = error.code;

    if (error.code === 'NOT_FOUND') {
      status = 404;
      message = 'Picture Book resource not found';
    } else if (error.code === 'FEATURE_DISABLED') {
      status = 503;
      message = 'Picture Book AI is not enabled';
    } else {
      status = 409;
      message = 'Picture Book workflow state conflict';
    }
  }

  request.log.warn({ requestId: request.id, errorCode: code }, 'Picture Book AI request failed');

  return reply.status(status).send({ error: { code, message, requestId: request.id } });
}
