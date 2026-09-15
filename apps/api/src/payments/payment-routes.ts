import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  createPaymentRequestSchema,
  createPaymentResponseSchema,
  paymentStatusSchema,
  refundRequestSchema,
  refundResponseSchema,
} from '@xiaohai/contracts/payments';
import type { ConsumerSessionService } from '../auth/session.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import { ConsumerAuthError } from '../auth/errors.js';
import { PaymentError } from './wechat-pay.js';
import type { PaymentService } from './payment-service.js';

export function registerPaymentRoutes(
  app: FastifyInstance,
  options: {
    payments: PaymentService;
    consumerSessions: ConsumerSessionService;
    staffAuthorization: StaffAuthorizationService;
  },
) {
  const staff = async (request: FastifyRequest, permission: string) => {
    const context = await options.staffAuthorization.authenticate(request.headers.authorization);
    options.staffAuthorization.requirePermission(context, permission);
    options.staffAuthorization.requireDataScope(context, 'GLOBAL', null);
    return context.staffAccountId;
  };
  app.post('/api/v1/payments/wechat', async (request, reply) => {
    try {
      const token = request.headers.authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
      const claims = token ? options.consumerSessions.verify(token) : null;
      if (!claims) throw new PaymentError('CONSUMER_AUTHENTICATION_REQUIRED', 401);
      const input = createPaymentRequestSchema.safeParse(request.body);
      if (!input.success) throw new PaymentError('INVALID_REQUEST', 400);
      reply.header('Cache-Control', 'no-store');
      return createPaymentResponseSchema.parse(
        await options.payments.create(claims.consumerUserId, input.data.orderId),
      );
    } catch (error) {
      return failure(request, reply, error);
    }
  });
  app.get('/api/v1/staff/payments', async (request, reply) => {
    try {
      await staff(request, 'payments.read');
      return { payments: z.array(paymentStatusSchema).parse(await options.payments.list()) };
    } catch (error) {
      return failure(request, reply, error);
    }
  });
  app.post('/api/v1/staff/refunds', async (request, reply) => {
    try {
      const staffId = await staff(request, 'payments.refund');
      const input = refundRequestSchema.safeParse(request.body);
      if (!input.success) throw new PaymentError('INVALID_REQUEST', 400);
      const result = refundResponseSchema.parse(
        await options.payments.requestRefund(input.data.paymentId, staffId),
      );
      request.log.info(
        {
          requestId: request.id,
          staffId,
          paymentId: input.data.paymentId,
          refundId: result.id,
          status: result.status,
        },
        'Refund requested',
      );
      return result;
    } catch (error) {
      return failure(request, reply, error);
    }
  });
  app.post('/api/v1/staff/payments/:id/reconcile', async (request, reply) => {
    try {
      const staffId = await staff(request, 'payments.reconcile');
      const params = z.object({ id: z.uuid() }).safeParse(request.params);
      if (!params.success) throw new PaymentError('INVALID_REQUEST', 400);
      const result = await options.payments.reconcile(params.data.id, staffId);
      request.log[
        result.outcome === 'FAILED' || result.outcome === 'REVIEW_REQUIRED' ? 'warn' : 'info'
      ]({ requestId: request.id, paymentId: params.data.id, ...result }, 'Payment reconciliation');
      return result;
    } catch (error) {
      return failure(request, reply, error);
    }
  });
  // Encapsulation preserves all existing API JSON parsers and consumer/staff behavior.
  void app.register((webhooks, _options, done) => {
    webhooks.removeContentTypeParser('application/json');
    webhooks.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: 65536 },
      (_request, body, done) => done(null, body),
    );
    webhooks.post('/api/v1/payments/wechat/notify', async (request, reply) => {
      try {
        if (typeof request.body !== 'string') throw new PaymentError('INVALID_REQUEST', 400);
        const result = await options.payments.callback(request.body, request.headers);
        if (result.reviewRequired)
          request.log.warn(
            { requestId: request.id, alert: 'PAYMENT_REVIEW_REQUIRED' },
            'Late or conflicting payment requires finance review',
          );
        return reply.status(204).send();
      } catch (error) {
        return failure(request, reply, error);
      }
    });
    done();
  });
}
function failure(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  const code =
    error instanceof PaymentError || error instanceof ConsumerAuthError
      ? error.code
      : 'INTERNAL_ERROR';
  const status =
    error instanceof PaymentError || error instanceof ConsumerAuthError ? error.statusCode : 500;
  request.log.warn({ requestId: request.id, errorCode: code }, 'Payment operation failed');
  return reply.status(status).send({ error: { code, message: code, requestId: request.id } });
}
