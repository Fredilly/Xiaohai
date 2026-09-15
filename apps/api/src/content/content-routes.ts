import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  contentQuerySchema,
  episodeInputSchema,
  mediaInputSchema,
  progressUpdateSchema,
  seriesInputSchema,
} from '@xiaohai/contracts/content';
import type { ConsumerSessionService } from '../auth/session.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import { ConsumerAuthError } from '../auth/errors.js';
import { ContentError, type ContentService } from './content-service.js';

export const CONTENT_MANAGE_PERMISSION = 'content.manage';
export function registerContentRoutes(
  app: FastifyInstance,
  options: {
    content: ContentService;
    consumerSessions: ConsumerSessionService;
    staffAuthorization: StaffAuthorizationService;
  },
) {
  const optionalConsumer = (request: FastifyRequest) => {
    const raw = request.headers.authorization;
    if (!raw?.startsWith('Bearer ')) return null;
    return options.consumerSessions.verify(raw.slice(7))?.consumerUserId ?? null;
  };
  const consumer = (request: FastifyRequest) => {
    const id = optionalConsumer(request);
    if (!id) throw new ContentAuthError();
    return id;
  };
  const staff = async (request: FastifyRequest) => {
    const ctx = await options.staffAuthorization.authenticate(request.headers.authorization);
    options.staffAuthorization.requirePermission(ctx, CONTENT_MANAGE_PERMISSION);
    options.staffAuthorization.requireDataScope(ctx, 'GLOBAL', null);
    return ctx;
  };
  app.get('/api/v1/content/series', async (request, reply) => {
    const input = contentQuerySchema.safeParse(request.query);
    if (!input.success) return invalid(reply, request.id);
    try {
      return await options.content.list(input.data.q, input.data.category);
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.get('/api/v1/content/series/:id', async (request, reply) => {
    const p = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!p.success) return invalid(reply, request.id);
    try {
      return await options.content.detail(p.data.id);
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.get('/api/v1/content/episodes/:id/playback', async (request, reply) => {
    const p = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!p.success) return invalid(reply, request.id);
    try {
      return await options.content.playback(optionalConsumer(request), p.data.id);
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.put('/api/v1/content/episodes/:id/progress', async (request, reply) => {
    const p = z.object({ id: z.uuid() }).safeParse(request.params);
    const input = progressUpdateSchema.safeParse(request.body);
    if (!p.success || !input.success) return invalid(reply, request.id);
    try {
      return await options.content.saveProgress(
        consumer(request),
        p.data.id,
        input.data.positionSeconds,
        input.data.completed,
      );
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.get('/api/v1/content/continue-watching', async (request, reply) => {
    try {
      return await options.content.continueWatching(consumer(request));
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.get('/api/v1/content/my-entitlements', async (request, reply) => {
    try {
      return await options.content.entitlements(consumer(request));
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.get('/api/v1/staff/content', async (request, reply) => {
    try {
      await staff(request);
      return await options.content.adminList();
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.post('/api/v1/staff/content/series', async (request, reply) => {
    const input = seriesInputSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      await staff(request);
      return reply.status(201).send(await options.content.createSeries(input.data));
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.put('/api/v1/staff/content/series/:id', async (request, reply) => {
    const p = z.object({ id: z.uuid() }).safeParse(request.params);
    const input = seriesInputSchema.safeParse(request.body);
    if (!p.success || !input.success) return invalid(reply, request.id);
    try {
      await staff(request);
      return await options.content.updateSeries(p.data.id, input.data);
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.post('/api/v1/staff/content/episodes', async (request, reply) => {
    const input = episodeInputSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      await staff(request);
      return reply.status(201).send(await options.content.createEpisode(input.data));
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.post('/api/v1/staff/content/media', async (request, reply) => {
    const input = mediaInputSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      await staff(request);
      return reply.status(201).send(await options.content.createMedia(input.data));
    } catch (e) {
      return fail(request, reply, e);
    }
  });
}
class ContentAuthError extends Error {}
function invalid(reply: FastifyReply, requestId: string) {
  return reply
    .status(400)
    .send({ error: { code: 'INVALID_REQUEST', message: 'Invalid request', requestId } });
}
function fail(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  let status = 500,
    code = 'INTERNAL_ERROR',
    message = 'Internal server error';
  if (error instanceof ContentAuthError) {
    status = 401;
    code = 'CONSUMER_AUTHENTICATION_REQUIRED';
    message = 'Consumer authentication required';
  } else if (error instanceof ConsumerAuthError) {
    status = error.statusCode;
    code = error.code;
    message = status === 401 ? 'Staff authentication required' : 'Forbidden';
  } else if (error instanceof ContentError) {
    code = error.code;
    status = code === 'NOT_FOUND' ? 404 : code === 'CONTENT_LOCKED' ? 403 : 409;
    message =
      code === 'NOT_FOUND'
        ? 'Content not found'
        : code === 'CONTENT_LOCKED'
          ? 'Content entitlement required'
          : 'Media unavailable';
  }
  request.log.warn({ requestId: request.id, errorCode: code }, 'Content request failed');
  return reply.status(status).send({ error: { code, message, requestId: request.id } });
}
