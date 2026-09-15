import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import {
  apiErrorResponseSchema,
  healthResponseSchema,
  staffAuthorizationProbeQuerySchema,
  staffAuthorizationProbeResponseSchema,
  staffLoginRequestSchema,
  staffLoginResponseSchema,
  staffMeResponseSchema,
  wechatLoginRequestSchema,
  wechatLoginResponseSchema,
} from '@xiaohai/contracts';
import { ConsumerAuthError } from './auth/errors.js';
import type { ConsumerAuthService } from './auth/consumer-auth-service.js';
import type { StaffAuthService } from './auth/staff-auth-service.js';
import type { StaffAuthorizationService } from './auth/staff-authorization.js';

export interface BuildAppOptions {
  consumerAuth?: ConsumerAuthService;
  staffAuth?: StaffAuthService;
  staffAuthorization?: StaffAuthorizationService;
  logger?: boolean;
  loggerInstance?: FastifyBaseLogger;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    ...(options.loggerInstance
      ? { loggerInstance: options.loggerInstance }
      : { logger: options.logger ?? true }),
    requestIdHeader: 'x-request-id',
  });
  app.addHook('onSend', (request, reply, _payload, done) => {
    void reply.header('x-request-id', request.id);
    done();
  });
  app.get('/health', () => healthResponseSchema.parse({ status: 'ok', service: 'api' }));

  if (options.consumerAuth) {
    app.post('/api/v1/auth/wechat/login', async (request, reply) => {
      const input = wechatLoginRequestSchema.safeParse(request.body);
      if (!input.success) return sendInvalidRequest(reply, request.id);

      try {
        return wechatLoginResponseSchema.parse(await options.consumerAuth!.login(input.data.code));
      } catch (error) {
        return sendAuthError(request, reply, error, 'Consumer WeChat login failed');
      }
    });
  }

  if (options.staffAuth) {
    app.post('/api/v1/staff/auth/login', async (request, reply) => {
      const input = staffLoginRequestSchema.safeParse(request.body);
      if (!input.success) return sendInvalidRequest(reply, request.id);

      try {
        return staffLoginResponseSchema.parse(
          await options.staffAuth!.login(input.data.loginIdentifier, input.data.password),
        );
      } catch (error) {
        return sendAuthError(request, reply, error, 'Staff login failed');
      }
    });
  }

  if (options.staffAuthorization) {
    app.get('/api/v1/staff/me', async (request, reply) => {
      try {
        const context = await options.staffAuthorization!.authenticate(
          request.headers.authorization,
        );
        return staffMeResponseSchema.parse({
          staff: { id: context.staffAccountId, loginIdentifier: context.loginIdentifier },
          permissions: context.permissions,
          dataScopes: context.dataScopes,
        });
      } catch (error) {
        return sendAuthError(request, reply, error, 'Staff identity resolution failed');
      }
    });

    app.get('/api/v1/staff/authorization/probe', async (request, reply) => {
      const input = staffAuthorizationProbeQuerySchema.safeParse(request.query);
      if (!input.success) return sendInvalidRequest(reply, request.id);

      try {
        const context = await options.staffAuthorization!.authenticate(
          request.headers.authorization,
        );
        options.staffAuthorization!.requirePermission(context, input.data.permission);
        options.staffAuthorization!.requireDataScope(
          context,
          input.data.scopeType,
          input.data.scopeId ?? null,
        );
        return staffAuthorizationProbeResponseSchema.parse({ allowed: true });
      } catch (error) {
        return sendAuthError(request, reply, error, 'Staff authorization denied');
      }
    });
  }

  return app;
}

function sendInvalidRequest(reply: FastifyReply, requestId: string) {
  return reply.status(400).send(
    apiErrorResponseSchema.parse({
      error: { code: 'INVALID_REQUEST', message: 'Invalid request', requestId },
    }),
  );
}

function sendAuthError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
  logMessage: string,
) {
  const authError =
    error instanceof ConsumerAuthError ? error : new ConsumerAuthError('INTERNAL_ERROR', 500);
  request.log.warn({ requestId: request.id, errorCode: authError.code }, logMessage);
  return reply.status(authError.statusCode).send(
    apiErrorResponseSchema.parse({
      error: {
        code: authError.code,
        message: publicErrorMessage(authError.code),
        requestId: request.id,
      },
    }),
  );
}

function publicErrorMessage(code: ConsumerAuthError['code']): string {
  switch (code) {
    case 'WECHAT_CODE_INVALID':
      return 'WeChat login code is invalid or expired';
    case 'WECHAT_PROVIDER_UNAVAILABLE':
    case 'WECHAT_RESPONSE_INVALID':
      return 'WeChat authentication is temporarily unavailable';
    case 'INVALID_REQUEST':
      return 'Invalid request';
    case 'STAFF_AUTHENTICATION_FAILED':
      return 'Invalid staff credentials or account unavailable';
    case 'STAFF_AUTHENTICATION_REQUIRED':
      return 'Staff authentication required';
    case 'STAFF_FORBIDDEN':
      return 'Staff access forbidden';
    case 'INTERNAL_ERROR':
      return 'Internal server error';
  }
}
