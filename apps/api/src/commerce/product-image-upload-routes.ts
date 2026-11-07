import { z } from 'zod';
import { merchantProductImageUploadSchema } from '@xiaohai/contracts/commerce';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ConsumerAuthError } from '../auth/errors.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import { StoreNetworkError, type StoreNetworkService } from '../stores/store-service.js';
import { ProductImageError, type ProductImageUploadService } from './product-image-upload-service.js';


const storeParams = z.object({ storeId: z.uuid(), productId: z.uuid() });
const productParams = z.object({ productId: z.uuid() });

export function registerProductImageUploadRoutes(
  app: FastifyInstance,
  options: {
    staffAuthorization: StaffAuthorizationService;
    stores: StoreNetworkService;
    images: ProductImageUploadService;
  },
) {
  // A single route body may contain 2 MiB encoded image bytes, but unauthenticated
  // callers still hit a strict per-route 3 MiB cap. Nothing is persisted until
  // token, permission, Store scope and product DRAFT/version are checked.
  app.post(
    '/api/v1/staff/stores/:storeId/catalog/products/:productId/images',
    { bodyLimit: 3 * 1024 * 1024 },
    async (request, reply) => {
      const params = storeParams.safeParse(request.params);
      const input = merchantProductImageUploadSchema.safeParse(request.body);
      if (!params.success || !input.success) return invalid(request, reply);
      try {
        const actor = await options.staffAuthorization.authenticate(request.headers.authorization);
        options.staffAuthorization.requirePermission(actor, 'stores.read');
        options.staffAuthorization.requirePermission(actor, 'catalog.edit');
        await options.stores.getStaffStore(params.data.storeId, actor);
        return reply.status(201).send(
          await options.images.upload({
            ...input.data,
            productId: params.data.productId,
            scopedStoreId: params.data.storeId,
            actorStaffAccountId: actor.staffAccountId,
            requestId: request.id,
          }),
        );
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  app.post(
    '/api/v1/staff/catalog/products/:productId/images',
    { bodyLimit: 3 * 1024 * 1024 },
    async (request, reply) => {
      const params = productParams.safeParse(request.params);
      const input = merchantProductImageUploadSchema.safeParse(request.body);
      if (!params.success || !input.success) return invalid(request, reply);
      try {
        const actor = await options.staffAuthorization.authenticate(request.headers.authorization);
        options.staffAuthorization.requirePermission(actor, 'catalog.manage');
        options.staffAuthorization.requireDataScope(actor, 'GLOBAL', null);
        return reply.status(201).send(
          await options.images.upload({
            ...input.data,
            productId: params.data.productId,
            scopedStoreId: null,
            actorStaffAccountId: actor.staffAccountId,
            requestId: request.id,
          }),
        );
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
  } else if (error instanceof ProductImageError) {
    code = error.code;
    status =
      error.code === 'NOT_FOUND'
        ? 404
        : error.code === 'INVALID_IMAGE'
          ? 400
          : error.code === 'SHARED_FORBIDDEN'
            ? 403
            : error.code === 'MEDIA_UNAVAILABLE'
              ? 503
              : 409;
  }
  request.log.warn({ requestId: request.id, errorCode: code }, 'Product image upload failed');
  return reply.status(status).send({
    error: {
      code,
      message:
        status === 401
          ? 'Authentication required'
          : status === 403
            ? 'Access forbidden'
            : status === 409
              ? 'Product changed, reload before uploading'
              : status === 503
                ? 'Image storage is unavailable'
                : 'Request failed',
      requestId: request.id,
    },
  });
}
