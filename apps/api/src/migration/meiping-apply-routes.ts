import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import type { StoreNetworkService } from '../stores/store-service.js';
import { ConsumerAuthError } from '../auth/errors.js';
import {
  MeipingApplyError,
  type MeipingApplyAuditContext,
  type MeipingApplyService,
} from './meiping-apply-service.js';

const sessionParams = z.object({ sessionId: z.uuid() });
const batchParams = z.object({ batchId: z.uuid() });
const storeQuery = z.object({ storeId: z.uuid() }).strict();

export function registerMeipingApplyRoutes(
  app: FastifyInstance,
  options: {
    apply: MeipingApplyService;
    staffAuthorization: StaffAuthorizationService;
    stores: StoreNetworkService;
  },
) {
  const authorize = async (
    request: FastifyRequest,
    storeId: string,
    permission: 'meiping.import.preview' | 'meiping.import.approve' | 'meiping.import.execute',
  ): Promise<MeipingApplyAuditContext> => {
    const actor = await options.staffAuthorization.authenticate(request.headers.authorization);
    options.staffAuthorization.requirePermission(actor, permission);
    await options.stores.getStaffStore(storeId, actor);
    return { actorStaffAccountId: actor.staffAccountId, requestId: request.id };
  };
  const authorizeBatchRead = async (request: FastifyRequest, storeId: string) => {
    const actor = await options.staffAuthorization.authenticate(request.headers.authorization);
    if (!(
      options.staffAuthorization.hasPermission(actor, 'meiping.import.preview') ||
      options.staffAuthorization.hasPermission(actor, 'meiping.import.approve') ||
      options.staffAuthorization.hasPermission(actor, 'meiping.import.execute')
    )) {
      throw new ConsumerAuthError('STAFF_FORBIDDEN', 403);
    }
    await options.stores.getStaffStore(storeId, actor);
    return { actorStaffAccountId: actor.staffAccountId, requestId: request.id };
  };

  app.post(
    '/api/v1/staff/migrations/meiping/review-sessions/:sessionId/import-preview',
    async (request, reply) => {
      const params = sessionParams.safeParse(request.params);
      const query = storeQuery.safeParse(request.query);
      if (!params.success || !query.success) return invalid(reply, request.id);
      try {
        const audit = await authorize(request, query.data.storeId, 'meiping.import.preview');
        return await options.apply.preview(params.data.sessionId, query.data.storeId, audit);
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  app.post(
    '/api/v1/staff/migrations/meiping/import-batches/:batchId/approve',
    async (request, reply) => {
      const params = batchParams.safeParse(request.params);
      const query = storeQuery.safeParse(request.query);
      if (!params.success || !query.success) return invalid(reply, request.id);
      try {
        const audit = await authorize(request, query.data.storeId, 'meiping.import.approve');
        return await options.apply.approve(params.data.batchId, query.data.storeId, audit);
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  app.post(
    '/api/v1/staff/migrations/meiping/import-batches/:batchId/execute',
    async (request, reply) => {
      const params = batchParams.safeParse(request.params);
      const query = storeQuery.safeParse(request.query);
      if (!params.success || !query.success) return invalid(reply, request.id);
      try {
        const audit = await authorize(request, query.data.storeId, 'meiping.import.execute');
        return await options.apply.execute(params.data.batchId, query.data.storeId, audit);
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  app.get('/api/v1/staff/migrations/meiping/import-batches/:batchId', async (request, reply) => {
    const params = batchParams.safeParse(request.params);
    const query = storeQuery.safeParse(request.query);
    if (!params.success || !query.success) return invalid(reply, request.id);
    try {
      const audit = await authorizeBatchRead(request, query.data.storeId);
      void audit;
      return await options.apply.getBatch(params.data.batchId, query.data.storeId);
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
  if (error instanceof ConsumerAuthError) {
    return reply
      .status(error.statusCode)
      .send({ error: { code: error.code, message: 'Forbidden', requestId: request.id } });
  }
  if (error instanceof MeipingApplyError) {
    const status =
      error.code === 'NOT_FOUND'
        ? 404
        : error.code === 'APPROVAL_REQUIRED' ||
            error.code === 'APPROVAL_SEPARATION_REQUIRED' ||
            error.code === 'EXECUTION_DISABLED'
          ? 409
          : 400;
    const messages: Record<MeipingApplyError['code'], string> = {
      NOT_FOUND: 'Import batch not found',
      CONFLICT: 'Import review is stale or has unresolved conflicts',
      DECISION_REQUIRED: 'Every source row requires a final review decision',
      CORRECTION_NOT_ACCEPTED: 'Only independently accepted corrections may be applied',
      APPROVAL_REQUIRED: 'Final import approval is required',
      APPROVAL_SEPARATION_REQUIRED: 'Final approval must be performed by a different staff account',
      EXECUTION_DISABLED: 'Formal Meiping execution is disabled in this environment',
      EXISTING_INVENTORY: 'Existing inventory prevents a silent stock overwrite',
      EXISTING_IMPORT: 'This SKU has already been included in an import batch',
      SHARED_CATALOG_CHANGE_REQUIRES_REVIEW:
        'Shared catalog changes must be handled through the catalog review workflow',
      AMBIGUOUS_SKU_MATCH: 'The source row matches multiple SKUs and requires manual resolution',
      SKU_MATCH_NOT_FOUND: 'The source SKU code does not match the existing product',
      INVALID_SOURCE: 'The persisted source checksum or store does not match',
    };
    return reply
      .status(status)
      .send({ error: { code: error.code, message: messages[error.code], requestId: request.id } });
  }
  request.log.warn(
    { requestId: request.id, errorCode: 'MEIPING_IMPORT_FAILED' },
    'Meiping import request failed',
  );
  return reply.status(400).send({
    error: {
      code: 'INVALID_MEIPING_IMPORT',
      message: 'Import request rejected',
      requestId: request.id,
    },
  });
}
