import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  deliveryZoneInputSchema,
  deliveryZoneListQuerySchema,
  deliveryZoneListResponseSchema,
  fulfilledOrderRequestSchema,
  fulfilledOrderResponseSchema,
  fulfillmentActionRequestSchema,
  fulfillmentQuoteRequestSchema,
  fulfillmentQuoteSchema,
  fulfillmentStaffListQuerySchema,
  fulfillmentStaffListResponseSchema,
  fulfillmentViewSchema,
  pickupVerifyRequestSchema,
} from '@xiaohai/contracts/fulfillment';
import { ConsumerAuthError } from '../auth/errors.js';
import type { ConsumerSessionService } from '../auth/session.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import {
  FulfillmentError,
  fulfillmentPermissions,
  type FulfillmentService,
} from './fulfillment-service.js';

const orderParamsSchema = z.object({ id: z.uuid() }).strict();

export function registerFulfillmentRoutes(
  app: FastifyInstance,
  options: {
    fulfillment: FulfillmentService;
    consumerSessions: ConsumerSessionService;
    staffAuthorization: StaffAuthorizationService;
  },
) {
  const consumerId = (request: FastifyRequest) => {
    const token = request.headers.authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
    const claims = token ? options.consumerSessions.verify(token) : null;
    if (!claims) throw new FulfillmentAuthError();
    return claims.consumerUserId;
  };
  const staff = async (request: FastifyRequest, permission: string) => {
    const context = await options.staffAuthorization.authenticate(request.headers.authorization);
    options.staffAuthorization.requirePermission(context, permission);
    return context;
  };

  app.post('/api/v1/fulfillment/quote', async (request, reply) => {
    const input = fulfillmentQuoteRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      return fulfillmentQuoteSchema.parse(
        await options.fulfillment.quote(consumerId(request), input.data),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/fulfillment/orders', async (request, reply) => {
    const input = fulfilledOrderRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      const orderId = await options.fulfillment.createOrder(consumerId(request), input.data);
      return reply.status(201).send(fulfilledOrderResponseSchema.parse({ orderId }));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/fulfillment/orders/:id', async (request, reply) => {
    const params = orderParamsSchema.safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);
    try {
      return fulfillmentViewSchema.parse(
        await options.fulfillment.getForConsumer(consumerId(request), params.data.id),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/staff/fulfillment', async (request, reply) => {
    const query = fulfillmentStaffListQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply, request.id);
    try {
      return fulfillmentStaffListResponseSchema.parse(
        await options.fulfillment.listForStaff(
          await staff(request, fulfillmentPermissions.read),
          query.data,
        ),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/staff/delivery-zones', async (request, reply) => {
    const query = deliveryZoneListQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply, request.id);
    try {
      return deliveryZoneListResponseSchema.parse(
        await options.fulfillment.listZones(
          await staff(request, fulfillmentPermissions.read),
          query.data,
        ),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/staff/delivery-zones', async (request, reply) => {
    const input = deliveryZoneInputSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      const zone = await options.fulfillment.createZone(
        await staff(request, fulfillmentPermissions.manage),
        input.data,
      );
      return reply.status(201).send(zone);
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/staff/fulfillment/orders/:id/pickup/ready', async (request, reply) => {
    const params = orderParamsSchema.safeParse(request.params);
    const input = fulfillmentActionRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      return fulfillmentViewSchema.parse(
        await options.fulfillment.markPickupReady(
          await staff(request, fulfillmentPermissions.pickup),
          params.data.id,
        ),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/staff/fulfillment/orders/:id/pickup/verify', async (request, reply) => {
    const params = orderParamsSchema.safeParse(request.params);
    const input = pickupVerifyRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      return fulfillmentViewSchema.parse(
        await options.fulfillment.verifyPickup(
          await staff(request, fulfillmentPermissions.pickup),
          params.data.id,
          input.data.pickupCode,
          input.data.idempotencyKey,
        ),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/staff/fulfillment/orders/:id/delivery/dispatch', async (request, reply) => {
    const params = orderParamsSchema.safeParse(request.params);
    const input = fulfillmentActionRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      return fulfillmentViewSchema.parse(
        await options.fulfillment.dispatchDelivery(
          await staff(request, fulfillmentPermissions.delivery),
          params.data.id,
          input.data.idempotencyKey,
        ),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/staff/fulfillment/orders/:id/delivery/complete', async (request, reply) => {
    const params = orderParamsSchema.safeParse(request.params);
    const input = fulfillmentActionRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      return fulfillmentViewSchema.parse(
        await options.fulfillment.completeDelivery(
          await staff(request, fulfillmentPermissions.delivery),
          params.data.id,
          input.data.idempotencyKey,
        ),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
}

class FulfillmentAuthError extends Error {}

function invalid(reply: FastifyReply, requestId: string) {
  return reply.status(400).send({
    error: { code: 'INVALID_REQUEST', message: 'Invalid request', requestId },
  });
}

function fail(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof FulfillmentAuthError) {
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
  if (error instanceof FulfillmentError) {
    const status =
      error.code === 'NOT_FOUND'
        ? 404
        : error.code === 'FORBIDDEN'
          ? 403
          : error.code === 'PICKUP_CODE_INVALID'
            ? 400
            : 409;
    return reply.status(status).send({
      error: { code: error.code, message: error.code, requestId: request.id },
    });
  }
  request.log.error(
    { requestId: request.id, errorCode: 'INTERNAL_ERROR' },
    'Fulfillment request failed',
  );
  return reply.status(500).send({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: request.id },
  });
}
