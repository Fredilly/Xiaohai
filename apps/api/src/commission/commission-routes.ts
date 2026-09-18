import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  commissionAccountSchema,
  createCommissionRuleRequestSchema,
  createReferralLinkRequestSchema,
  createWithdrawalRequestSchema,
  referralLinkListResponseSchema,
  referralLinkSchema,
  reviewWithdrawalRequestSchema,
  staffCommissionOverviewSchema,
  updateCommissionRuleStatusRequestSchema,
  withdrawalListResponseSchema,
  withdrawalSchema,
} from '@xiaohai/contracts/commission';
import { ConsumerAuthError } from '../auth/errors.js';
import type { ConsumerSessionService } from '../auth/session.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import {
  CommissionError,
  commissionPermissions,
  type CommissionService,
} from './commission-service.js';

const idParams = z.object({ id: z.uuid() }).strict();

export function registerCommissionRoutes(
  app: FastifyInstance,
  options: {
    commission: CommissionService;
    consumerSessions: ConsumerSessionService;
    staffAuthorization: StaffAuthorizationService;
  },
) {
  const consumer = (request: FastifyRequest) => {
    const token = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '')?.[1];
    const claims = token ? options.consumerSessions.verify(token) : null;
    if (!claims) throw new CommissionRouteAuthError();
    return claims.consumerUserId;
  };
  const staff = async (request: FastifyRequest, permission: string) => {
    const context = await options.staffAuthorization.authenticate(request.headers.authorization);
    options.staffAuthorization.requirePermission(context, permission);
    options.staffAuthorization.requireDataScope(context, 'GLOBAL', null);
    return context;
  };

  app.post('/api/v1/referrals/links', async (request, reply) => {
    const input = createReferralLinkRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      return reply
        .status(201)
        .send(
          referralLinkSchema.parse(
            await options.commission.createReferralLink(consumer(request), input.data.label),
          ),
        );
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.get('/api/v1/referrals/links', async (request, reply) => {
    try {
      return referralLinkListResponseSchema.parse(
        await options.commission.listReferralLinks(consumer(request)),
      );
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.get('/api/v1/commissions/account', async (request, reply) => {
    try {
      return commissionAccountSchema.parse(await options.commission.getAccount(consumer(request)));
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.get('/api/v1/commissions/withdrawals', async (request, reply) => {
    try {
      return withdrawalListResponseSchema.parse(
        await options.commission.listWithdrawals(consumer(request)),
      );
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.post('/api/v1/commissions/withdrawals', async (request, reply) => {
    const input = createWithdrawalRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      const result = await options.commission.createWithdrawal(
        consumer(request),
        input.data.amountMinor,
        input.data.clientRequestId,
      );
      request.log.info(
        { requestId: request.id, withdrawalId: result.id, action: 'WITHDRAWAL_REQUESTED' },
        'Commission withdrawal requested',
      );
      return reply.status(201).send(withdrawalSchema.parse(result));
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.post('/api/v1/commissions/withdrawals/:id/cancel', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);
    try {
      return withdrawalSchema.parse(
        await options.commission.cancelWithdrawal(consumer(request), params.data.id),
      );
    } catch (e) {
      return fail(request, reply, e);
    }
  });

  app.get('/api/v1/staff/commissions', async (request, reply) => {
    try {
      await staff(request, commissionPermissions.read);
      return staffCommissionOverviewSchema.parse(await options.commission.staffOverview());
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.post('/api/v1/staff/commissions/rules', async (request, reply) => {
    const input = createCommissionRuleRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      const context = await staff(request, commissionPermissions.rulesManage);
      return reply
        .status(201)
        .send(await options.commission.createRule(context.staffAccountId, input.data));
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.post('/api/v1/staff/commissions/rules/:id/status', async (request, reply) => {
    const params = idParams.safeParse(request.params),
      input = updateCommissionRuleStatusRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      await staff(request, commissionPermissions.rulesManage);
      return await options.commission.setRuleStatus(
        params.data.id,
        input.data.status,
        input.data.version,
      );
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.post('/api/v1/staff/commissions/events/:id/settle', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);
    try {
      await staff(request, commissionPermissions.settle);
      return await options.commission.settle(params.data.id);
    } catch (e) {
      return fail(request, reply, e);
    }
  });
  app.post('/api/v1/staff/commissions/withdrawals/:id/review', async (request, reply) => {
    const params = idParams.safeParse(request.params),
      input = reviewWithdrawalRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      const context = await staff(request, commissionPermissions.withdrawalsReview);
      const result = await options.commission.reviewWithdrawal(
        params.data.id,
        context.staffAccountId,
        input.data,
      );
      request.log.info(
        { requestId: request.id, withdrawalId: params.data.id, action: input.data.action },
        'Commission withdrawal reviewed',
      );
      return withdrawalSchema.parse(result);
    } catch (e) {
      return fail(request, reply, e);
    }
  });
}

class CommissionRouteAuthError extends Error {}
function invalid(reply: FastifyReply, requestId: string) {
  return reply
    .status(400)
    .send({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', requestId } });
}
function fail(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof CommissionRouteAuthError)
    return reply.status(401).send({
      error: {
        code: 'CONSUMER_AUTHENTICATION_REQUIRED',
        message: 'Authentication required',
        requestId: request.id,
      },
    });
  if (error instanceof ConsumerAuthError)
    return reply
      .status(error.statusCode)
      .send({ error: { code: error.code, message: error.code, requestId: request.id } });
  if (error instanceof CommissionError) {
    const status =
      error.code === 'NOT_FOUND' ? 404 : error.code === 'INSUFFICIENT_BALANCE' ? 422 : 409;
    return reply
      .status(status)
      .send({ error: { code: error.code, message: error.code, requestId: request.id } });
  }
  request.log.error(
    { requestId: request.id, errorCode: 'INTERNAL_ERROR' },
    'Commission request failed',
  );
  return reply.status(500).send({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: request.id },
  });
}
