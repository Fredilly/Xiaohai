import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  createFranchiseeRequestSchema,
  createRegionRequestSchema,
  createStoreRequestSchema,
  publicStoreQuerySchema,
  updateFranchiseeRequestSchema,
  updateRegionRequestSchema,
  updateStoreRequestSchema,
} from '@xiaohai/contracts/stores';
import { ConsumerAuthError } from '../auth/errors.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import { StoreNetworkError, type StoreNetworkService } from './store-service.js';

export const STORES_READ_PERMISSION = 'stores.read';
export const STORES_MANAGE_PERMISSION = 'stores.manage';

export function registerStoreRoutes(
  app: FastifyInstance,
  options: {
    stores: StoreNetworkService;
    staffAuthorization: StaffAuthorizationService;
  },
) {
  app.get('/api/v1/stores/regions', async (request, reply) => {
    try {
      return await options.stores.listPublicRegions();
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/stores', async (request, reply) => {
    const input = publicStoreQuerySchema.safeParse(request.query);
    if (!input.success) return invalid(reply, request.id);
    try {
      return await options.stores.listPublicStores(input.data);
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/stores/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);
    try {
      return await options.stores.getPublicStore(params.data.id);
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/staff/stores', async (request, reply) => {
    try {
      const context = await authorize(request, options.staffAuthorization, STORES_READ_PERMISSION);
      return await options.stores.listStaffStores(context);
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/staff/stores/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);
    try {
      const context = await authorize(request, options.staffAuthorization, STORES_READ_PERMISSION);
      return await options.stores.getStaffStore(params.data.id, context);
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/staff/stores/regions', async (request, reply) => {
    const input = createRegionRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      const context = await authorize(
        request,
        options.staffAuthorization,
        STORES_MANAGE_PERMISSION,
      );
      return reply.status(201).send(await options.stores.createRegion(context, input.data));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.patch('/api/v1/staff/stores/regions/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    const input = updateRegionRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      const context = await authorize(
        request,
        options.staffAuthorization,
        STORES_MANAGE_PERMISSION,
      );
      return await options.stores.updateRegion(context, params.data.id, input.data);
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/staff/stores/franchisees', async (request, reply) => {
    const input = createFranchiseeRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      const context = await authorize(
        request,
        options.staffAuthorization,
        STORES_MANAGE_PERMISSION,
      );
      return reply.status(201).send(await options.stores.createFranchisee(context, input.data));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.patch('/api/v1/staff/stores/franchisees/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    const input = updateFranchiseeRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      const context = await authorize(
        request,
        options.staffAuthorization,
        STORES_MANAGE_PERMISSION,
      );
      return await options.stores.updateFranchisee(context, params.data.id, input.data);
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/staff/stores', async (request, reply) => {
    const input = createStoreRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      const context = await authorize(
        request,
        options.staffAuthorization,
        STORES_MANAGE_PERMISSION,
      );
      return reply.status(201).send(await options.stores.createStore(context, input.data));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.patch('/api/v1/staff/stores/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    const input = updateStoreRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      const context = await authorize(
        request,
        options.staffAuthorization,
        STORES_MANAGE_PERMISSION,
      );
      return await options.stores.updateStore(context, params.data.id, input.data);
    } catch (error) {
      return fail(request, reply, error);
    }
  });
}

async function authorize(
  request: FastifyRequest,
  authorization: StaffAuthorizationService,
  permission: string,
) {
  const context = await authorization.authenticate(request.headers.authorization);
  authorization.requirePermission(context, permission);
  return context;
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
  } else if (error instanceof StoreNetworkError) {
    if (error.code === 'NOT_FOUND') {
      status = 404;
      code = 'NOT_FOUND';
      message = 'Store network resource not found';
    } else if (error.code === 'CONFLICT') {
      status = 409;
      code = 'CONFLICT';
      message = 'Store network resource conflict';
    } else {
      status = 403;
      code = 'STAFF_FORBIDDEN';
      message = 'Staff access forbidden';
    }
  }

  request.log.warn({ requestId: request.id, errorCode: code }, 'Store network request failed');
  return reply.status(status).send({ error: { code, message, requestId: request.id } });
}
