import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditLogListQuerySchema, auditLogListResponseSchema } from '@xiaohai/contracts/audit';
import { ConsumerAuthError } from '../auth/errors.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import type { AuditService } from './audit-service.js';

export const AUDIT_READ_PERMISSION = 'audit.read';

export function registerAuditRoutes(
  app: FastifyInstance,
  options: { audit: AuditService; staffAuthorization: StaffAuthorizationService },
) {
  app.get('/api/v1/staff/audit-logs', async (request, reply) => {
    const input = auditLogListQuerySchema.safeParse(request.query);
    if (!input.success) return invalid(reply, request.id);

    try {
      const context = await options.staffAuthorization.authenticate(request.headers.authorization);
      options.staffAuthorization.requirePermission(context, AUDIT_READ_PERMISSION);
      options.staffAuthorization.requireDataScope(context, 'GLOBAL', null);
      return auditLogListResponseSchema.parse(await options.audit.list(input.data));
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
  }

  request.log.warn({ requestId: request.id, errorCode: code }, 'Audit read request failed');
  return reply.status(status).send({ error: { code, message, requestId: request.id } });
}
