import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import {
  apiErrorResponseSchema,
  healthResponseSchema,
  wechatLoginRequestSchema,
  wechatLoginResponseSchema,
} from '@xiaohai/contracts';
import { ConsumerAuthError } from './auth/errors.js';
import type { ConsumerAuthService } from './auth/consumer-auth-service.js';

export interface BuildAppOptions {
  consumerAuth?: ConsumerAuthService;
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
      if (!input.success) {
        return reply.status(400).send(
          apiErrorResponseSchema.parse({
            error: {
              code: 'INVALID_REQUEST',
              message: 'Invalid request body',
              requestId: request.id,
            },
          }),
        );
      }

      try {
        return wechatLoginResponseSchema.parse(await options.consumerAuth!.login(input.data.code));
      } catch (error) {
        const authError =
          error instanceof ConsumerAuthError ? error : new ConsumerAuthError('INTERNAL_ERROR', 500);
        request.log.warn(
          { requestId: request.id, errorCode: authError.code },
          'Consumer WeChat login failed',
        );
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
    });
  }
  return app;
}

function publicErrorMessage(code: ConsumerAuthError['code']): string {
  switch (code) {
    case 'WECHAT_CODE_INVALID':
      return 'WeChat login code is invalid or expired';
    case 'WECHAT_PROVIDER_UNAVAILABLE':
    case 'WECHAT_RESPONSE_INVALID':
      return 'WeChat authentication is temporarily unavailable';
    case 'INVALID_REQUEST':
      return 'Invalid request body';
    case 'INTERNAL_ERROR':
      return 'Internal server error';
  }
}
