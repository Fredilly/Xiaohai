import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  staffAdminAccountSchema,
  staffAdminCreateAccountSchema,
  staffAdminListQuerySchema,
  staffAdminListResponseSchema,
  staffAdminOkSchema,
  staffAdminPermissionsResponseSchema,
  staffAdminReplaceDataScopesSchema,
  staffAdminReplaceRolesSchema,
  staffAdminResetPasswordSchema,
  staffAdminRolesResponseSchema,
  staffAdminSetEnabledSchema,
} from '@xiaohai/contracts/staff-admin';
import { ConsumerAuthError } from '../auth/errors.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import { StaffAdminError, type StaffAdminService } from './staff-admin-service.js';

export const STAFF_ADMIN_READ_PERMISSION = 'staff.read';
export const STAFF_ADMIN_MANAGE_PERMISSION = 'staff.manage';

export function registerStaffAdminRoutes(
  app: FastifyInstance,
  options: { staffAdmin: StaffAdminService; staffAuthorization: StaffAuthorizationService },
) {
  const authorize = async (request: FastifyRequest, permission: string) => {
    const context = await options.staffAuthorization.authenticate(request.headers.authorization);
    options.staffAuthorization.requirePermission(context, permission);
    options.staffAuthorization.requireDataScope(context, 'GLOBAL', null);
    return context;
  };

  app.get('/api/v1/staff/admin/accounts', async (request, reply) => {
    const input = staffAdminListQuerySchema.safeParse(request.query);
    if (!input.success) return invalid(reply, request.id);
    try {
      await authorize(request, STAFF_ADMIN_READ_PERMISSION);
      return staffAdminListResponseSchema.parse(await options.staffAdmin.listStaff(input.data));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/staff/admin/accounts/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);
    try {
      await authorize(request, STAFF_ADMIN_READ_PERMISSION);
      return staffAdminAccountSchema.parse(await options.staffAdmin.getStaff(params.data.id));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/staff/admin/accounts', async (request, reply) => {
    const input = staffAdminCreateAccountSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      const context = await authorize(request, STAFF_ADMIN_MANAGE_PERMISSION);
      return reply.status(201).send(
        staffAdminAccountSchema.parse(
          await options.staffAdmin.createStaff(input.data, {
            actorStaffAccountId: context.staffAccountId,
            requestId: request.id,
          }),
        ),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.patch('/api/v1/staff/admin/accounts/:id/enabled', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    const input = staffAdminSetEnabledSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      const context = await authorize(request, STAFF_ADMIN_MANAGE_PERMISSION);
      return staffAdminAccountSchema.parse(
        await options.staffAdmin.setEnabled(params.data.id, input.data.enabled, {
          actorStaffAccountId: context.staffAccountId,
          requestId: request.id,
        }),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/staff/admin/accounts/:id/reset-password', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    const input = staffAdminResetPasswordSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      const context = await authorize(request, STAFF_ADMIN_MANAGE_PERMISSION);
      return staffAdminOkSchema.parse(
        await options.staffAdmin.resetPassword(params.data.id, input.data.password, {
          actorStaffAccountId: context.staffAccountId,
          requestId: request.id,
        }),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.put('/api/v1/staff/admin/accounts/:id/roles', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    const input = staffAdminReplaceRolesSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      const context = await authorize(request, STAFF_ADMIN_MANAGE_PERMISSION);
      return staffAdminAccountSchema.parse(
        await options.staffAdmin.replaceRoles(params.data.id, input.data, {
          actorStaffAccountId: context.staffAccountId,
          requestId: request.id,
        }),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.put('/api/v1/staff/admin/accounts/:id/data-scopes', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    const input = staffAdminReplaceDataScopesSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      const context = await authorize(request, STAFF_ADMIN_MANAGE_PERMISSION);
      return staffAdminAccountSchema.parse(
        await options.staffAdmin.replaceDataScopes(params.data.id, input.data, {
          actorStaffAccountId: context.staffAccountId,
          requestId: request.id,
        }),
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/staff/admin/roles', async (request, reply) => {
    try {
      await authorize(request, STAFF_ADMIN_READ_PERMISSION);
      return staffAdminRolesResponseSchema.parse(await options.staffAdmin.listRoles());
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/staff/admin/permissions', async (request, reply) => {
    try {
      await authorize(request, STAFF_ADMIN_READ_PERMISSION);
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
  } else if (error instanceof StaffAdminError) {
    if (error.code === 'NOT_FOUND') {
      status = 404;
      code = 'NOT_FOUND';
      message = 'Staff account not found';
    } else if (error.code === 'CONFLICT') {
      status = 409;
      code = 'CONFLICT';
      message = 'Staff login identifier already exists';
    } else if (error.code === 'SELF_LOCKOUT') {
      status = 409;
      code = 'SELF_LOCKOUT';
      message = 'Current Staff cannot remove its own administrative access';
    } else if (error.code === 'INVALID_REFERENCE') {
      status = 400;
      code = 'INVALID_REFERENCE';
      message = 'Referenced role or data scope target does not exist';
    }
  }

  request.log.warn({ requestId: request.id, errorCode: code }, 'Staff admin request failed');
  return reply.status(status).send({ error: { code, message, requestId: request.id } });
}
