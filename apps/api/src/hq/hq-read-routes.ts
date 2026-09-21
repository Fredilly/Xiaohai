import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  hqOrderDetailSchema,
  hqOrderListQuerySchema,
  hqOrderListResponseSchema,
  hqUserDetailSchema,
  hqUserListQuerySchema,
  hqUserListResponseSchema,
} from '@xiaohai/contracts/hq';
import { ConsumerAuthError } from '../auth/errors.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import { HqReadError, type HqReadService } from './hq-read-service.js';

export const HQ_ORDERS_READ_PERMISSION = 'orders.read';
export const HQ_USERS_READ_PERMISSION = 'users.read';

export function registerHqReadRoutes(
  app: FastifyInstance,
  options: { hqRead: HqReadService; staffAuthorization: StaffAuthorizationService },
) {
  const authorize = async (request: FastifyRequest, permission: string) => {
    const context = await options.staffAuthorization.authenticate(request.headers.authorization);
    options.staffAuthorization.requirePermission(context, permission);
    options.staffAuthorization.requireDataScope(context, 'GLOBAL', null);
  };

  app.get('/api/v1/staff/orders', async (request, reply) => {
    const input = hqOrderListQuerySchema.safeParse(request.query);
    if (!input.success) return invalid(reply, request.id);
    try {
      await authorize(request, HQ_ORDERS_READ_PERMISSION);
      return hqOrderListResponseSchema.parse(await options.hqRead.listOrders(input.data));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/staff/orders/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);
    try {
      await authorize(request, HQ_ORDERS_READ_PERMISSION);
      return hqOrderDetailSchema.parse(await options.hqRead.getOrder(params.data.id));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/staff/users', async (request, reply) => {
    const input = hqUserListQuerySchema.safeParse(request.query);
    if (!input.success) return invalid(reply, request.id);
    try {
      await authorize(request, HQ_USERS_READ_PERMISSION);
      return hqUserListResponseSchema.parse(await options.hqRead.listUsers(input.data));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/staff/users/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);
    try {
      await authorize(request, HQ_USERS_READ_PERMISSION);
      return hqUserDetailSchema.parse(await options.hqRead.getUser(params.data.id));
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

  if (error instanceof ConsumerAuthError) {
    status = error.statusCode;
    code = error.code;
    message = status === 401 ? 'Staff authentication required' : 'Staff access forbidden';
  } else if (error instanceof HqReadError && error.code === 'NOT_FOUND') {
    status = 404;
    code = 'NOT_FOUND';
    message = 'HQ resource not found';
  }

  request.log.warn({ requestId: request.id, errorCode: code }, 'HQ read request failed');
  return reply.status(status).send({ error: { code, message, requestId: request.id } });
}
