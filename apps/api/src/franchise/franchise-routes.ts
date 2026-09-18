import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  assignFranchiseApplicationRequestSchema,
  createFranchiseApplicationRequestSchema,
  createFranchiseFollowupRequestSchema,
  franchiseApplicationListQuerySchema,
  franchiseApplicationListResponseSchema,
  franchiseApplicationSubmissionResponseSchema,
  franchiseApplicationViewSchema,
  reviewFranchiseApplicationRequestSchema,
  updateFranchiseApplicationStatusRequestSchema,
} from '@xiaohai/contracts/franchise';
import { ConsumerAuthError } from '../auth/errors.js';
import type { ConsumerSessionService } from '../auth/session.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import { FranchiseError, franchisePermissions, type FranchiseService } from './franchise-service.js';

const paramsSchema = z.object({ id: z.uuid() }).strict();

export function registerFranchiseRoutes(
  app: FastifyInstance,
  options: {
    franchise: FranchiseService;
    consumerSessions: ConsumerSessionService;
    staffAuthorization: StaffAuthorizationService;
  },
) {
  const optionalConsumer = (request: FastifyRequest) => {
    if (!request.headers.authorization) return null;
    const token = bearer(request.headers.authorization);
    const claims = token ? options.consumerSessions.verify(token) : null;
    if (!claims) throw new FranchiseConsumerAuthError();
    return claims.consumerUserId;
  };

  const staff = async (request: FastifyRequest, permission: string) => {
    const context = await options.staffAuthorization.authenticate(request.headers.authorization);
    options.staffAuthorization.requirePermission(context, permission);
    options.staffAuthorization.requireDataScope(context, 'GLOBAL', null);
    return context;
  };

  app.post('/api/v1/franchise/applications', async (request, reply) => {
    const input = createFranchiseApplicationRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      const result = await options.franchise.createApplication(input.data, optionalConsumer(request));
      request.log.info(
        { requestId: request.id, applicationId: result.id, action: 'SUBMIT' },
        'Franchise application submitted',
      );
      return reply.status(201).send(franchiseApplicationSubmissionResponseSchema.parse(result));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/staff/franchise/applications', async (request, reply) => {
    const input = franchiseApplicationListQuerySchema.safeParse(request.query);
    if (!input.success) return invalid(reply, request.id);
    try {
      await staff(request, franchisePermissions.read);
      return franchiseApplicationListResponseSchema.parse(
        await options.franchise.listApplications(input.data),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/staff/franchise/applications/:id', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);
    try {
      await staff(request, franchisePermissions.read);
      return franchiseApplicationViewSchema.parse(
        await options.franchise.getApplication(params.data.id),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/staff/franchise/applications/:id/assign', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const input = assignFranchiseApplicationRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      await staff(request, franchisePermissions.assign);
      const result = await options.franchise.assign(params.data.id, input.data);
      request.log.info(
        { requestId: request.id, applicationId: params.data.id, action: 'ASSIGN' },
        'Franchise application assigned',
      );
      return franchiseApplicationViewSchema.parse(result);
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/staff/franchise/applications/:id/followups', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const input = createFranchiseFollowupRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      const context = await staff(request, franchisePermissions.followup);
      const result = await options.franchise.addFollowup(
        params.data.id,
        context.staffAccountId,
        input.data,
      );
      request.log.info(
        { requestId: request.id, applicationId: params.data.id, action: 'FOLLOW_UP' },
        'Franchise follow-up recorded',
      );
      return franchiseApplicationViewSchema.parse(result);
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/staff/franchise/applications/:id/review', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const input = reviewFranchiseApplicationRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      const context = await staff(request, franchisePermissions.review);
      const result = await options.franchise.review(
        params.data.id,
        context.staffAccountId,
        input.data,
      );
      request.log.info(
        { requestId: request.id, applicationId: params.data.id, action: 'REVIEW' },
        'Franchise application reviewed',
      );
      return franchiseApplicationViewSchema.parse(result);
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/staff/franchise/applications/:id/status', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const input = updateFranchiseApplicationStatusRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      await staff(request, franchisePermissions.manage);
      const result = await options.franchise.updateStatus(params.data.id, input.data);
      request.log.info(
        { requestId: request.id, applicationId: params.data.id, action: 'STATUS' },
        'Franchise application status changed',
      );
      return franchiseApplicationViewSchema.parse(result);
    } catch (error) {
      return fail(request, reply, error);
    }
  });
}

function bearer(value?: string) {
  return /^Bearer\s+(.+)$/i.exec(value?.trim() ?? '')?.[1] ?? null;
}

class FranchiseConsumerAuthError extends Error {}

function invalid(reply: FastifyReply, requestId: string) {
  return reply.status(400).send({
    error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', requestId },
  });
}

function fail(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof FranchiseConsumerAuthError) {
    return reply.status(401).send({
      error: {
        code: 'CONSUMER_AUTHENTICATION_REQUIRED',
        message: 'Authentication required',
        requestId: request.id,
      },
    });
  }
  if (error instanceof ConsumerAuthError) {
    return reply.status(error.statusCode).send({
      error: { code: error.code, message: error.code, requestId: request.id },
    });
  }
  if (error instanceof FranchiseError) {
    const status =
      error.code === 'NOT_FOUND'
        ? 404
        : error.code === 'ASSIGNEE_INVALID'
          ? 400
          : error.code === 'INVALID_STATE' || error.code === 'STALE_VERSION'
            ? 409
            : 409;
    return reply.status(status).send({
      error: { code: error.code, message: error.code, requestId: request.id },
    });
  }
  request.log.error(
    { requestId: request.id, errorCode: 'INTERNAL_ERROR' },
    'Franchise request failed',
  );
  return reply.status(500).send({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: request.id },
  });
}
