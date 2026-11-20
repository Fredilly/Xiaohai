import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  storeCatalogEditRequestSchema,
  storeCatalogQuerySchema,
} from '@xiaohai/contracts/commerce';
import { ConsumerAuthError } from '../auth/errors.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import { StoreNetworkError, type StoreNetworkService } from '../stores/store-service.js';
import type { StoreCatalogReadService } from './store-catalog-read-service.js';
import { CatalogEditError, type CatalogEditService } from './catalog-edit-service.js';

export const CATALOG_EDIT_PERMISSION = 'catalog.edit';
/** Store edits are scoped by StoreNetworkService and the editor's full impact graph. */
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

export function registerStoreCatalogEditRoutes(
  app: FastifyInstance,
  options: {
    staffAuthorization: StaffAuthorizationService;
    stores: StoreNetworkService;
    catalog: CatalogEditService;
  },
) {
  app.post('/api/v1/staff/stores/:id/catalog/:skuId/preview', async (request, reply) => {
    const params = z.object({ id: z.uuid(), skuId: z.uuid() }).safeParse(request.params);
    const body = storeCatalogEditRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({
        error: { code: 'INVALID_REQUEST', message: 'Invalid request', requestId: request.id },
      });
    }
    try {
      const actor = await options.staffAuthorization.authenticate(request.headers.authorization);
      options.staffAuthorization.requirePermission(actor, 'stores.read');
      options.staffAuthorization.requirePermission(actor, CATALOG_EDIT_PERMISSION);
      await options.stores.getStaffStore(params.data.id, actor);
      return await options.catalog.preview(
        params.data.id,
        params.data.skuId,
        body.data,
        actor.staffAccountId,
        'STORE_ONLY',
      );
    } catch (error) {
      return editFail(request, reply, error);
    }
  });

  app.patch('/api/v1/staff/stores/:id/catalog/:skuId', async (request, reply) => {
    const params = z.object({ id: z.uuid(), skuId: z.uuid() }).safeParse(request.params);
    const body = storeCatalogEditRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({
        error: { code: 'INVALID_REQUEST', message: 'Invalid request', requestId: request.id },
      });
    }
    try {
      const actor = await options.staffAuthorization.authenticate(request.headers.authorization);
      options.staffAuthorization.requirePermission(actor, 'stores.read');
      options.staffAuthorization.requirePermission(actor, CATALOG_EDIT_PERMISSION);
      await options.stores.getStaffStore(params.data.id, actor);
      return await options.catalog.update(
        params.data.id,
        params.data.skuId,
        actor.staffAccountId,
        request.id,
        body.data,
        'STORE_ONLY',
        typeof request.headers['x-catalog-preview-token'] === 'string'
          ? request.headers['x-catalog-preview-token']
          : undefined,
      );
    } catch (error) {
      return editFail(request, reply, error);
    }
  });
}

/** HQ uses the same versioned editor, with GLOBAL authorization checked here. */
export function registerHqCatalogEditRoutes(
  app: FastifyInstance,
  options: {
    staffAuthorization: StaffAuthorizationService;
    stores: StoreNetworkService;
    catalog: StoreCatalogReadService;
    editor: CatalogEditService;
  },
) {
  const authorizeHq = async (request: FastifyRequest) => {
    const actor = await options.staffAuthorization.authenticate(request.headers.authorization);
    options.staffAuthorization.requirePermission(actor, 'catalog.manage');
    options.staffAuthorization.requireDataScope(actor, 'GLOBAL', null);
    return actor;
  };

  app.get('/api/v1/staff/catalog/stores/:id/items', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    const query = storeCatalogQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return invalidRequest(request, reply);
    try {
      const actor = await authorizeHq(request);
      await options.stores.getStaffStore(params.data.id, actor);
      return await options.catalog.list(params.data.id, query.data);
    } catch (error) {
      return editFail(request, reply, error);
    }
  });

  app.post('/api/v1/staff/catalog/stores/:id/items/:skuId/preview', async (request, reply) => {
    const params = z.object({ id: z.uuid(), skuId: z.uuid() }).safeParse(request.params);
    const body = storeCatalogEditRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) return invalidRequest(request, reply);
    try {
      const actor = await authorizeHq(request);
      await options.stores.getStaffStore(params.data.id, actor);
      return await options.editor.preview(
        params.data.id,
        params.data.skuId,
        body.data,
        actor.staffAccountId,
        true,
      );
    } catch (error) {
      return editFail(request, reply, error);
    }
  });

  app.patch('/api/v1/staff/catalog/stores/:id/items/:skuId', async (request, reply) => {
    const params = z.object({ id: z.uuid(), skuId: z.uuid() }).safeParse(request.params);
    const body = storeCatalogEditRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) return invalidRequest(request, reply);
    try {
      const actor = await authorizeHq(request);
      await options.stores.getStaffStore(params.data.id, actor);
      const previewToken = request.headers['x-catalog-preview-token'];
      return await options.editor.update(
        params.data.id,
        params.data.skuId,
        actor.staffAccountId,
        request.id,
        body.data,
        true,
        typeof previewToken === 'string' ? previewToken : undefined,
      );
    } catch (error) {
      return editFail(request, reply, error);
    }
  });
}

function invalidRequest(request: FastifyRequest, reply: FastifyReply) {
  return reply.status(400).send({
    error: { code: 'INVALID_REQUEST', message: 'Invalid request', requestId: request.id },
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

function editFail(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  if (error instanceof ConsumerAuthError) {
    status = error.statusCode;
    code = error.code;
  } else if (error instanceof StoreNetworkError) {
    status = error.code === 'SCOPE_MISMATCH' ? 403 : error.code === 'NOT_FOUND' ? 404 : 409;
    code = status === 403 ? 'STAFF_FORBIDDEN' : error.code;
  } else if (error instanceof CatalogEditError) {
    status =
      error.code === 'NOT_FOUND'
        ? 404
        : error.code === 'INVALID_REFERENCE'
          ? 400
          : error.code === 'SHARED_FORBIDDEN'
            ? 403
            : 409;
    code = error.code;
  }
  request.log.warn({ requestId: request.id, errorCode: code }, 'Store catalog edit failed');
  return reply.status(status).send({
    error: {
      code,
      message:
        status === 403
          ? 'Access forbidden'
          : status === 409
            ? 'Catalog version conflict'
            : 'Request failed',
      requestId: request.id,
    },
  });
}
