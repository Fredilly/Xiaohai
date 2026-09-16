import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { aiJobListSchema, aiJobSchema, createAiJobRequestSchema } from '@xiaohai/contracts/ai';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import { ConsumerAuthError } from '../auth/errors.js';
import { AiPlatformError, type AiPlatformService } from './ai-service.js';

export const AI_MANAGE_PERMISSION = 'ai.manage';
export function registerAiRoutes(
  app: FastifyInstance,
  options: { ai: AiPlatformService; staffAuthorization: StaffAuthorizationService },
) {
  const staff = async (request: FastifyRequest) => {
    const context = await options.staffAuthorization.authenticate(request.headers.authorization);
    options.staffAuthorization.requirePermission(context, AI_MANAGE_PERMISSION);
    options.staffAuthorization.requireDataScope(context, 'GLOBAL', null);
    return context.staffAccountId;
  };
  app.post('/api/v1/staff/ai/jobs', async (request, reply) => {
    const input = createAiJobRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      return reply
        .status(202)
        .send(aiJobSchema.parse(await options.ai.enqueue(await staff(request), input.data)));
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.get('/api/v1/staff/ai/jobs', async (request, reply) => {
    try {
      await staff(request);
      return aiJobListSchema.parse(await options.ai.list());
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.get('/api/v1/staff/ai/jobs/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);
    try {
      await staff(request);
      return aiJobSchema.parse(await options.ai.get(params.data.id));
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  for (const action of ['cancel', 'retry'] as const)
    app.post(`/api/v1/staff/ai/jobs/:id/${action}`, async (request, reply) => {
      const params = z.object({ id: z.uuid() }).safeParse(request.params);
      if (!params.success) return invalid(reply, request.id);
      try {
        await staff(request);
        return aiJobSchema.parse(await options.ai[action](params.data.id));
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
  let status = 500,
    code = 'INTERNAL_ERROR';
  if (error instanceof ConsumerAuthError) {
    status = error.statusCode;
    code = error.code;
  } else if (error instanceof AiPlatformError) {
    code = error.code;
    status = code === 'NOT_FOUND' ? 404 : code === 'QUEUE_UNAVAILABLE' ? 503 : 409;
  }
  request.log.warn({ requestId: request.id, errorCode: code }, 'AI platform request failed');
  return reply.status(status).send({ error: { code, message: code, requestId: request.id } });
}
