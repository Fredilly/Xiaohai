import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  createFinanceReconciliationRunRequestSchema,
  financeLedgerListQuerySchema,
  financeLedgerListResponseSchema,
  financeReconciliationRunSchema,
  financeSummaryQuerySchema,
  financeSummaryResponseSchema,
} from '@xiaohai/contracts/finance';
import { ConsumerAuthError } from '../auth/errors.js';
import type {
  StaffAuthorizationContext,
  StaffAuthorizationService,
} from '../auth/staff-authorization.js';
import { FinanceServiceError, type FinanceService } from './finance-service.js';

export const FINANCE_READ_PERMISSION = 'finance.read';
export const FINANCE_RECONCILE_PERMISSION = 'finance.reconcile';

export function registerFinanceRoutes(
  app: FastifyInstance,
  options: { finance: FinanceService; staffAuthorization: StaffAuthorizationService },
) {
  const authorize = async (
    request: FastifyRequest,
    permission: string,
  ): Promise<StaffAuthorizationContext> => {
    const context = await options.staffAuthorization.authenticate(request.headers.authorization);
    options.staffAuthorization.requirePermission(context, permission);
    options.staffAuthorization.requireDataScope(context, 'GLOBAL', null);
    return context;
  };

  app.get('/api/v1/staff/finance/summary', async (request, reply) => {
    const input = financeSummaryQuerySchema.safeParse(request.query);
    if (!input.success) return invalid(reply, request.id);
    try {
      await authorize(request, FINANCE_READ_PERMISSION);
      return financeSummaryResponseSchema.parse(await options.finance.getSummary(input.data));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/staff/finance/ledger', async (request, reply) => {
    const input = financeLedgerListQuerySchema.safeParse(request.query);
    if (!input.success) return invalid(reply, request.id);
    try {
      await authorize(request, FINANCE_READ_PERMISSION);
      return financeLedgerListResponseSchema.parse(await options.finance.listLedger(input.data));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post('/api/v1/staff/finance/reconciliation-runs', async (request, reply) => {
    const input = createFinanceReconciliationRunRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      const context = await authorize(request, FINANCE_RECONCILE_PERMISSION);
      const run = await options.finance.createReconciliationRun(context.staffAccountId, input.data);
      return reply.status(201).send(financeReconciliationRunSchema.parse(run));
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/staff/finance/reconciliation-runs/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).strict().safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);
    try {
      await authorize(request, FINANCE_READ_PERMISSION);
      return financeReconciliationRunSchema.parse(
        await options.finance.getReconciliationRun(params.data.id),
      );
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
  } else if (error instanceof FinanceServiceError && error.code === 'NOT_FOUND') {
    status = 404;
    code = 'NOT_FOUND';
    message = 'Finance resource not found';
  }

  request.log.warn({ requestId: request.id, errorCode: code }, 'Finance request failed');
  return reply.status(status).send({ error: { code, message, requestId: request.id } });
}
