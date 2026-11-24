import {
  foodPhysicalReturnRequestSchema,
  type FoodLogisticsService,
} from './food-logistics-service.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  foodLotIntakeRequestSchema,
  foodTraceResponseSchema,
  foodOrderAllocationsResponseSchema,
  foodLotDispositionRequestSchema,
  foodBatchMovementRequestSchema,
} from '@xiaohai/contracts/food';
import { ConsumerAuthError } from '../auth/errors.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import { InventoryOperationsError } from './inventory-operations-service.js';
import {
  FoodStockError,
  type FoodStockOperationsService,
} from './food-stock-operations-service.js';
import {
  FoodBatchMovementError,
  type FoodBatchMovementService,
} from './food-batch-movement-service.js';

class FoodWritesDisabled extends Error {}
const querySchema = z.object({ storeId: z.uuid(), skuId: z.uuid() }).strict();

export function registerFoodStockRoutes(
  app: FastifyInstance,
  options: {
    staffAuthorization: StaffAuthorizationService;
    food: FoodStockOperationsService;
    movement: FoodBatchMovementService;
    writesEnabled?: boolean;
    logistics?: FoodLogisticsService;
  },
) {
  async function authenticate(request: FastifyRequest, permission: string, write = false) {
    const actor = await options.staffAuthorization.authenticate(request.headers.authorization);
    options.staffAuthorization.requirePermission(actor, 'inventory.read');
    options.staffAuthorization.requirePermission(actor, permission);
    if (write && options.writesEnabled !== true) throw new FoodWritesDisabled();
    return actor;
  }
  app.post('/api/v1/staff/inventory/food-stock/physical-returns', async (request, reply) => {
    const input = foodPhysicalReturnRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(request, reply);
    try {
      const actor = await authenticate(request, 'inventory.receive', true);
      if (!options.logistics) throw new FoodWritesDisabled();
      return await options.logistics.receiveReturn(actor, input.data);
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.get('/api/v1/staff/inventory/food-stock/order/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).strict().safeParse(request.params);
    if (!params.success) return invalid(request, reply);
    try {
      const actor = await authenticate(request, 'inventory.read');
      if (!options.logistics) throw new FoodWritesDisabled();
      return foodOrderAllocationsResponseSchema.parse(
        await options.logistics.orderAllocations(actor, params.data.id),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.get('/api/v1/staff/inventory/food-stock/trace/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).strict().safeParse(request.params);
    if (!params.success) return invalid(request, reply);
    try {
      const actor = await authenticate(request, 'inventory.read');
      if (!options.logistics) throw new FoodWritesDisabled();
      return foodTraceResponseSchema.parse(await options.logistics.trace(actor, params.data.id));
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.get('/api/v1/staff/inventory/food-stock', async (request, reply) => {
    const input = querySchema.safeParse(request.query);
    if (!input.success) return invalid(request, reply);
    try {
      const actor = await authenticate(request, 'inventory.read');
      return await options.food.read(actor, input.data.storeId, input.data.skuId);
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.post('/api/v1/staff/inventory/food-stock/intake', async (request, reply) => {
    const input = foodLotIntakeRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(request, reply);
    try {
      const actor = await authenticate(request, 'inventory.receive', true);
      return reply.status(201).send(await options.food.receive(actor, input.data, request.id));
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.post('/api/v1/staff/inventory/food-stock/disposition', async (request, reply) => {
    const input = foodLotDispositionRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(request, reply);
    try {
      const actor = await authenticate(request, 'inventory.adjust', true);
      return await options.food.disposition(actor, input.data, request.id);
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.post('/api/v1/staff/inventory/food-stock/movements', async (request, reply) => {
    const input = foodBatchMovementRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(request, reply);
    try {
      const permission =
        input.data.kind === 'EXISTING_LOT_RECEIPT' ? 'inventory.receive' : 'inventory.adjust';
      const actor = await authenticate(request, permission, true);
      return await options.movement.apply(actor, input.data);
    } catch (error) {
      return fail(request, reply, error);
    }
  });
}
function invalid(request: FastifyRequest, reply: FastifyReply) {
  return reply.status(400).send({
    error: {
      code: 'INVALID_FOOD_INPUT',
      message: 'Invalid food stock request',
      requestId: request.id,
    },
  });
}
function fail(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  let status = 500;
  let code = 'FOOD_STOCK_INTERNAL_ERROR';
  if (error instanceof ConsumerAuthError) {
    status = error.statusCode;
    code = error.code;
  } else if (error instanceof FoodWritesDisabled) {
    status = 503;
    code = 'FOOD_STOCK_WRITES_DISABLED';
  } else if (
    error instanceof FoodStockError ||
    error instanceof FoodBatchMovementError ||
    error instanceof InventoryOperationsError
  ) {
    code = error.code;
    status =
      code === 'FORBIDDEN'
        ? 403
        : code === 'NOT_FOUND'
          ? 404
          : code.startsWith('INVALID')
            ? 400
            : 409;
  } else {
    const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : error;
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '23505') {
      status = 409;
      code = 'CONFLICT';
    }
  }
  request.log.warn({ requestId: request.id, errorCode: code }, 'Food stock operation stopped');
  return reply.status(status).send({
    error: {
      code,
      message: 'Food stock operation could not be completed',
      requestId: request.id,
    },
  });
}
