import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  staffAdminAccountSchema,
  staffAdminListQuerySchema,
  staffAdminListResponseSchema,
  staffAdminPermissionsResponseSchema,
  staffAdminRolesResponseSchema,
} from '@xiaohai/contracts/staff-admin';
import { ConsumerAuthError } from '../auth/errors.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import { StaffAdminError, type StaffAdminService } from './staff-admin-service.js';

export const STAFF_ADMIN_READ_PERMISSION = 'staff.read';

export function registerStaffAdminRoutes(
  app: FastifyInstance,
  options: { staffAdmin: StaffAdminService; staffAuthorization: StaffAuthorizationService },
) {
  const authorize = async (request: FastifyRequest) => {
    const context = await options.staffAuthorization.authenticate(request.headers.authorization);
    options.staffAuthorization.requirePermission(context, STAFF_ADMIN_READ_PERMISSION);
    options.staffAuthorization.requireDataScope(context, 'GLOBAL', null);
  };

  app.get('/api/v1/staff/admin/accounts', async (request, reply) => {
    const input = staffAdminListQuerySchema.safeParse(request.query);
    if (!input.success) return invalid(reply, request.id);
    try {
      await authorize(request);
      return staffAdminListResponseSchema.parse(await options.staffAdmin.listStaff(input.data));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/staff/admin/accounts/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);
    try {
      await authorize(request);
      return staffAdminAccountSchema.parse(await options.staffAdmin.getStaff(params.data.id));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/staff/admin/roles', async (request, reply) => {
    try {
      await authorize(request);
      return staffAdminRolesResponseSchema.parse(await options.staffAdmin.listRoles());
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/staff/admin/permissions', async (request, reply) => {
    try {
      await authorize(request);
      return staffAdminPermissionsResponseSchema.parse(await options.staffAdmin.listPermissions());
    } catch (error) {
      return fail(request, reply, error);
    }
  });
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
  } else if (error instanceof StaffAdminError && error.code === 'NOT_FOUND') {
    status = 404;
    code = 'NOT_FOUND';
    message = 'Staff account not found';
  }

  request.log.warn({ requestId: request.id, errorCode: code }, 'Staff admin read failed');
  return reply.status(status).send({ error: { code, message, requestId: request.id } });
}
