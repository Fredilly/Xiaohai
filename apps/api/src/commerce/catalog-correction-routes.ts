import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  createCatalogCorrectionSchema,
  reviewCatalogCorrectionSchema,
} from '@xiaohai/contracts/commerce';
import { ConsumerAuthError } from '../auth/errors.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import { StoreNetworkError, type StoreNetworkService } from '../stores/store-service.js';
import {
  CatalogCorrectionError,
  type CatalogCorrectionService,
} from './catalog-correction-service.js';

const storeParam = z.object({ id: z.uuid() });
const reviewParams = z.object({ id: z.uuid(), correctionId: z.uuid() });
const listQuery = z
  .object({
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();

export function registerCatalogCorrectionRoutes(
  app: FastifyInstance,
  options: {
    staffAuthorization: StaffAuthorizationService;
    stores: StoreNetworkService;
    corrections: CatalogCorrectionService;
  },
) {
  const authorize = async (
    request: FastifyRequest,
    storeId: string,
    intent: 'read' | 'submit' | 'review',
  ) => {
    const actor = await options.staffAuthorization.authenticate(request.headers.authorization);
    options.staffAuthorization.requirePermission(actor, 'stores.read');
    if (intent === 'submit') {
      options.staffAuthorization.requirePermission(actor, 'inventory.read');
      options.staffAuthorization.requirePermission(actor, 'inventory.stocktake');
    } else if (intent === 'review') {
      options.staffAuthorization.requirePermission(actor, 'catalog.correction.review');
    } else {
      const canRead =
        options.staffAuthorization.hasPermission(actor, 'catalog.correction.review') ||
        (options.staffAuthorization.hasPermission(actor, 'inventory.read') &&
          options.staffAuthorization.hasPermission(actor, 'inventory.stocktake'));
      if (!canRead) throw new ConsumerAuthError('STAFF_FORBIDDEN', 403);
    }
    await options.stores.getStaffStore(storeId, actor);
    return actor.staffAccountId;
  };

  app.get('/api/v1/staff/stores/:id/catalog-corrections', async (request, reply) => {
    const params = storeParam.safeParse(request.params);
    const query = listQuery.safeParse(request.query);
    if (!params.success || !query.success) return invalid(reply, request.id);
    try {
      await authorize(request, params.data.id, 'read');
      return await options.corrections.list(params.data.id, query.data);
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/staff/stores/:id/catalog-corrections', async (request, reply) => {
    const params = storeParam.safeParse(request.params);
    const body = createCatalogCorrectionSchema.safeParse(request.body);
    if (!params.success || !body.success) return invalid(reply, request.id);
    try {
      const actorId = await authorize(request, params.data.id, 'submit');
      return reply
        .status(201)
        .send(await options.corrections.submit(params.data.id, actorId, request.id, body.data));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post(
    '/api/v1/staff/stores/:id/catalog-corrections/:correctionId/review',
    async (request, reply) => {
      const params = reviewParams.safeParse(request.params);
      const body = reviewCatalogCorrectionSchema.safeParse(request.body);
      if (!params.success || !body.success) return invalid(reply, request.id);
      try {
        const actorId = await authorize(request, params.data.id, 'review');
        return await options.corrections.review(
          params.data.id,
          params.data.correctionId,
          actorId,
          request.id,
          body.data,
        );
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );
}

function invalid(reply: FastifyReply, requestId: string) {
  return reply.status(400).send({
    error: { code: 'INVALID_REQUEST', message: 'Invalid request', requestId },
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
  } else if (error instanceof CatalogCorrectionError) {
    code = error.code;
    status = code === 'NOT_FOUND' ? 404 : code === 'STAFF_FORBIDDEN' ? 403 : 409;
  }
  request.log.warn({ requestId: request.id, errorCode: code }, 'Store catalog correction failed');
  return reply.status(status).send({
    error: {
      code,
      message:
        status === 403
          ? 'Access forbidden'
          : status === 401
            ? 'Authentication required'
            : 'Request failed',
      requestId: request.id,
    },
  });
}
