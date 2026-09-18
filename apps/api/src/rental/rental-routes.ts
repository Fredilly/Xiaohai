import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  createRentalRequestSchema,
  rentalActionRequestSchema,
  rentalListQuerySchema,
} from '@xiaohai/contracts/rental';
import { ConsumerAuthError } from '../auth/errors.js';
import type { ConsumerSessionService } from '../auth/session.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import { RentalError, rentalPermissions, type RentalService } from './rental-service.js';

const paramsSchema = z.object({ id: z.uuid() }).strict();
export function registerRentalRoutes(
  app: FastifyInstance,
  options: {
    rental: RentalService;
    consumerSessions: ConsumerSessionService;
    staffAuthorization: StaffAuthorizationService;
  },
) {
  const consumer = (request: FastifyRequest) => {
    const token = bearer(request.headers.authorization);
    const claims = token ? options.consumerSessions.verify(token) : null;
    if (!claims) throw new RentalAuthError();
    return claims.consumerUserId;
  };
  const staff = async (request: FastifyRequest, permission: string) => {
    const context = await options.staffAuthorization.authenticate(request.headers.authorization);
    options.staffAuthorization.requirePermission(context, permission);
    return context;
  };

  app.post('/api/v1/rentals', async (request, reply) => {
    const input = createRentalRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      const result = await options.rental.reserve(consumer(request), input.data);
      request.log.info(
        { requestId: request.id, rentalOrderId: result.id, action: 'RESERVE' },
        'Rental reserved',
      );
      return reply.status(201).send(result);
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.get('/api/v1/rentals', async (request, reply) => {
    const input = rentalListQuerySchema.safeParse(request.query);
    if (!input.success) return invalid(reply, request.id);
    try {
      return await options.rental.listForConsumer(consumer(request), input.data);
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.get('/api/v1/rentals/:id', async (request, reply) => {
    const p = paramsSchema.safeParse(request.params);
    if (!p.success) return invalid(reply, request.id);
    try {
      return await options.rental.getForConsumer(consumer(request), p.data.id);
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.post('/api/v1/rentals/:id/cancel', async (request, reply) => {
    const p = paramsSchema.safeParse(request.params);
    const input = rentalActionRequestSchema.safeParse(request.body);
    if (!p.success || !input.success) return invalid(reply, request.id);
    try {
      const result = await options.rental.cancelConsumer(
        consumer(request),
        p.data.id,
        input.data.idempotencyKey,
      );
      request.log.info(
        { requestId: request.id, rentalOrderId: result.id, action: 'CANCEL' },
        'Rental cancelled',
      );
      return result;
    } catch (e) {
      return fail(request, reply, e);
    }
  });

  app.get('/api/v1/staff/rentals', async (request, reply) => {
    const input = rentalListQuerySchema.safeParse(request.query);
    if (!input.success) return invalid(reply, request.id);
    try {
      return await options.rental.listForStaff(
        await staff(request, rentalPermissions.read),
        input.data,
      );
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.get('/api/v1/staff/rentals/:id', async (request, reply) => {
    const p = paramsSchema.safeParse(request.params);
    if (!p.success) return invalid(reply, request.id);
    try {
      return await options.rental.getForStaff(
        await staff(request, rentalPermissions.read),
        p.data.id,
      );
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.post('/api/v1/staff/rentals/:id/borrow', async (request, reply) =>
    action(
      request,
      reply,
      rentalPermissions.checkout,
      'BORROW',
      (ctx, id, key) => options.rental.borrow(ctx, id, key),
      staff,
    ),
  );
  app.post('/api/v1/staff/rentals/:id/return', async (request, reply) =>
    action(
      request,
      reply,
      rentalPermissions.return,
      'RETURN',
      (ctx, id, key) => options.rental.returnRental(ctx, id, key),
      staff,
    ),
  );
  app.post('/api/v1/staff/rentals/:id/cancel', async (request, reply) =>
    action(
      request,
      reply,
      rentalPermissions.manage,
      'CANCEL',
      (ctx, id, key) => options.rental.cancelStaff(ctx, id, key),
      staff,
    ),
  );
}

async function action(
  request: FastifyRequest,
  reply: FastifyReply,
  permission: string,
  name: string,
  run: (
    ctx: Awaited<ReturnType<StaffAuthorizationService['authenticate']>>,
    id: string,
    key: string,
  ) => Promise<unknown>,
  auth: (
    request: FastifyRequest,
    permission: string,
  ) => Promise<Awaited<ReturnType<StaffAuthorizationService['authenticate']>>>,
) {
  const p = paramsSchema.safeParse(request.params);
  const input = rentalActionRequestSchema.safeParse(request.body);
  if (!p.success || !input.success) return invalid(reply, request.id);
  try {
    const result = await run(await auth(request, permission), p.data.id, input.data.idempotencyKey);
    request.log.info(
      { requestId: request.id, rentalOrderId: p.data.id, action: name },
      'Rental state changed',
    );
    return result;
  } catch (e) {
    return fail(request, reply, e);
  }
}
function bearer(value?: string) {
  return /^Bearer\s+(.+)$/i.exec(value?.trim() ?? '')?.[1] ?? null;
}
class RentalAuthError extends Error {}
function invalid(reply: FastifyReply, requestId: string) {
  return reply
    .status(400)
    .send({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', requestId } });
}
function fail(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof RentalAuthError)
    return reply.status(401).send({
      error: {
        code: 'CONSUMER_AUTHENTICATION_REQUIRED',
        message: 'Authentication required',
        requestId: request.id,
      },
    });
  if (error instanceof ConsumerAuthError)
    return reply
      .status(error.statusCode)
      .send({ error: { code: error.code, message: error.code, requestId: request.id } });
  if (error instanceof RentalError) {
    const status =
      error.code === 'NOT_FOUND'
        ? 404
        : error.code === 'FORBIDDEN'
          ? 403
          : error.code === 'INSUFFICIENT_STOCK'
            ? 409
            : 409;
    return reply
      .status(status)
      .send({ error: { code: error.code, message: error.code, requestId: request.id } });
  }
  request.log.error(
    { requestId: request.id, errorCode: 'INTERNAL_ERROR' },
    'Rental request failed',
  );
  return reply.status(500).send({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: request.id },
  });
}
