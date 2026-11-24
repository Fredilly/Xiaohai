import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { adminProductCreateInputSchema, adminProductSchema } from '@xiaohai/contracts/commerce';
import { ConsumerAuthError } from '../auth/errors.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import { StoreNetworkError, type StoreNetworkService } from '../stores/store-service.js';
import { CommerceError, type CommerceService } from './commerce-service.js';

/**
 * The Store product-create path is never a shortcut to HQ GLOBAL permission.
 * A Store can create only an unsellable DRAFT and receives a zero-stock
 * association with its own authorized Store in the same transaction.
 */
export function registerStoreCatalogCreateRoutes(
  app: FastifyInstance,
  options: {
    staffAuthorization: StaffAuthorizationService;
    stores: StoreNetworkService;
    commerce: CommerceService;
  },
) {
  app.post('/api/v1/staff/stores/:id/catalog/products', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    const input = adminProductCreateInputSchema.safeParse(request.body);
    const key = request.headers['idempotency-key'];
    if (
      !params.success ||
      !input.success ||
      typeof key !== 'string' ||
      !/^[A-Za-z0-9._:-]{8,128}$/.test(key)
    ) {
      return invalid(request, reply);
    }
    if (input.data.status !== 'DRAFT' || input.data.sku.availableForSale) {
      return invalid(request, reply);
    }

    try {
      const actor = await options.staffAuthorization.authenticate(request.headers.authorization);
      options.staffAuthorization.requirePermission(actor, 'stores.read');
      options.staffAuthorization.requirePermission(actor, 'catalog.edit');
      await options.stores.getStaffStore(params.data.id, actor);
      const created = await options.commerce.createStoreDraftProduct(
        input.data,
        actor.staffAccountId,
        request.id,
        params.data.id,
        key,
      );
      return reply.status(201).send(adminProductSchema.parse(created));
    } catch (error) {
      return fail(request, reply, error);
    }
  });
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
    status = error.code === 'NOT_FOUND' ? 404 : error.code === 'SCOPE_MISMATCH' ? 403 : 409;
    code = status === 403 ? 'STAFF_FORBIDDEN' : error.code;
  } else if (error instanceof CommerceError) {
    code = error.code;
    status = error.code === 'NOT_FOUND' ? 404 : error.code === 'INVALID_INPUT' ? 400 : 409;
  }
  request.log.warn({ requestId: request.id, errorCode: code }, 'Store catalog create failed');
  return reply.status(status).send({
    error: {
      code,
      message:
        status === 401
          ? 'Authentication required'
          : status === 403
            ? 'Access forbidden'
            : status === 409
              ? 'Product conflict'
              : 'Request failed',
      requestId: request.id,
    },
  });
}
