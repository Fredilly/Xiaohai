import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { storeCatalogQuerySchema } from '@xiaohai/contracts/commerce';
import { ConsumerAuthError } from '../auth/errors.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import { StoreNetworkError, type StoreNetworkService } from '../stores/store-service.js';
import type { StoreCatalogReadService } from './store-catalog-read-service.js';

/** Does not grant catalog.manage; global product mutation remains HQ-only. */
export function registerStoreCatalogReadRoutes(
  app: FastifyInstance,
  options: {
    staffAuthorization: StaffAuthorizationService;
    stores: StoreNetworkService;
    catalog: StoreCatalogReadService;
  },
) {
  app.get('/api/v1/staff/stores/:id/catalog', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    const query = storeCatalogQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.status(400).send({
        error: { code: 'INVALID_REQUEST', message: 'Invalid request', requestId: request.id },
      });
    }
    try {
      const actor = await options.staffAuthorization.authenticate(request.headers.authorization);
      options.staffAuthorization.requirePermission(actor, 'stores.read');
      options.staffAuthorization.requirePermission(actor, 'inventory.read');
      // Handles STORE/REGION/FRANCHISEE/GLOBAL scope using the existing authoritative store service.
      await options.stores.getStaffStore(params.data.id, actor);
      return await options.catalog.list(params.data.id, query.data);
    } catch (error) {
      return fail(request, reply, error);
    }
  });
}

function fail(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  let code = 'INTERNAL_ERROR';
  let status = 500;
  if (error instanceof ConsumerAuthError) {
    status = error.statusCode;
    code = error.code;
  } else if (error instanceof StoreNetworkError) {
    status = error.code === 'NOT_FOUND' ? 404 : error.code === 'SCOPE_MISMATCH' ? 403 : 409;
    code = status === 403 ? 'STAFF_FORBIDDEN' : error.code;
  }
  request.log.warn({ requestId: request.id, errorCode: code }, 'Store catalog read failed');
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
