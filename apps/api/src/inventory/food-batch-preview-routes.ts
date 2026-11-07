import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { packagedFoodPreviewRequestSchema } from '@xiaohai/contracts/food';
import { ConsumerAuthError } from '../auth/errors.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import { StoreNetworkError, type StoreNetworkService } from '../stores/store-service.js';
import {
  FoodBatchPreviewError,
  type FoodBatchPreviewService,
} from './food-batch-preview-service.js';

const paramsSchema = z.object({ storeId: z.uuid(), skuId: z.uuid() });

export function registerFoodBatchPreviewRoutes(
  app: FastifyInstance,
  options: {
    staffAuthorization: StaffAuthorizationService;
    stores: StoreNetworkService;
    food: FoodBatchPreviewService;
  },
) {
  /** Store and HQ share one business preview, with separate identity gates. */
  app.post(
    '/api/v1/staff/stores/:storeId/inventory/food-batches/:skuId/preview',
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const input = packagedFoodPreviewRequestSchema.safeParse(request.body);
      if (!params.success || !input.success) return invalid(request, reply);
      try {
        const actor = await options.staffAuthorization.authenticate(request.headers.authorization);
        options.staffAuthorization.requirePermission(actor, 'stores.read');
        options.staffAuthorization.requirePermission(actor, 'inventory.read');
        await options.stores.getStaffStore(params.data.storeId, actor);
        return await options.food.preview(params.data.storeId, params.data.skuId, input.data);
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  app.post(
    '/api/v1/staff/inventory/stores/:storeId/food-batches/:skuId/preview',
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const input = packagedFoodPreviewRequestSchema.safeParse(request.body);
      if (!params.success || !input.success) return invalid(request, reply);
      try {
        const actor = await options.staffAuthorization.authenticate(request.headers.authorization);
        options.staffAuthorization.requirePermission(actor, 'inventory.read');
        options.staffAuthorization.requireDataScope(actor, 'GLOBAL', null);
        return await options.food.preview(params.data.storeId, params.data.skuId, input.data);
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );
}

function invalid(request: FastifyRequest, reply: FastifyReply) {
  return reply.status(400).send({
    error: { code: 'INVALID_REQUEST', message: 'Invalid request', requestId: request.id },
  });
}

function fail(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  if (error instanceof ConsumerAuthError) {
    status = error.statusCode;
    code = error.code;
  } else if (error instanceof StoreNetworkError) {
    status = error.code === 'SCOPE_MISMATCH' ? 403 : error.code === 'NOT_FOUND' ? 404 : 409;
    code = status === 403 ? 'STAFF_FORBIDDEN' : error.code;
  } else if (error instanceof FoodBatchPreviewError) {
    status = 404;
    code = error.code;
  } else if (error instanceof Error && error.message.startsWith('CROSS_STORE_FOOD_BATCH')) {
    status = 400;
    code = 'INVALID_REQUEST';
  } else if (
    error instanceof Error &&
    [
      'INVALID_STOCK_QUANTITY',
      'INVALID_BUSINESS_DATE',
      'INVALID_FOOD_BATCH_STATE',
      'DUPLICATE_FOOD_BATCH',
      'TOO_MANY_FOOD_BATCHES',
    ].includes(error.message)
  ) {
    status = 400;
    code = 'INVALID_REQUEST';
  }
  request.log.warn({ requestId: request.id, errorCode: code }, 'Food batch preview rejected');
  return reply.status(status).send({
    error: {
      code,
      message:
        status === 401
          ? 'Authentication required'
          : status === 403
            ? 'Access forbidden'
            : status === 404
              ? 'SKU inventory not found'
              : status === 400
                ? 'Invalid batch proposal'
                : 'Request failed',
      requestId: request.id,
    },
  });
}
