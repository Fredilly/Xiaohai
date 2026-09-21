import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { safeLoggerOptions } from './security/logging.js';
import { registerAbuseControls, type RateLimitStore } from './security/rate-limit.js';
import {
  adminHomeResponseSchema,
  apiErrorResponseSchema,
  createCmsSectionRequestSchema,
  healthResponseSchema,
  publicHomeResponseSchema,
  reorderCmsSectionsRequestSchema,
  staffAuthorizationProbeQuerySchema,
  staffAuthorizationProbeResponseSchema,
  staffLoginRequestSchema,
  staffLoginResponseSchema,
  staffMeResponseSchema,
  updateCmsPageRequestSchema,
  updateCmsSectionRequestSchema,
  wechatLoginRequestSchema,
  wechatLoginResponseSchema,
} from '@xiaohai/contracts';
import { ConsumerAuthError } from './auth/errors.js';
import type { ConsumerAuthService } from './auth/consumer-auth-service.js';
import type { StaffAuthService } from './auth/staff-auth-service.js';
import type { StaffAuthorizationService } from './auth/staff-authorization.js';
import {
  CmsConflictError,
  CmsNotFoundError,
  HOME_CMS_PERMISSION,
  type HomeCmsService,
} from './cms/home-cms-service.js';

export interface BuildAppOptions {
  consumerAuth?: ConsumerAuthService;
  staffAuth?: StaffAuthService;
  staffAuthorization?: StaffAuthorizationService;
  homeCms?: HomeCmsService;
  logger?: boolean;
  loggerInstance?: FastifyBaseLogger;
  rateLimitStore?: RateLimitStore;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    ...(options.loggerInstance
      ? { loggerInstance: options.loggerInstance }
      : { logger: options.logger === false ? false : safeLoggerOptions }),
    // Correlation IDs used in audit records must not be supplied by the caller.
    genReqId: () => randomUUID(),
    disableRequestLogging: true,
  });
  app.setErrorHandler((error, request, reply) => {
    const status =
      error instanceof Error && 'statusCode' in error && error.statusCode === 413 ? 413 : 500;
    const code = status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR';
    request.log.warn({ requestId: request.id, errorCode: code }, 'Unhandled request error');
    return reply.status(status).send({
      error: {
        code,
        message: status === 413 ? 'Payload too large' : 'Internal server error',
        requestId: request.id,
      },
    });
  });
  if (options.rateLimitStore) registerAbuseControls(app, options.rateLimitStore);
  app.addHook('onSend', (request, reply, _payload, done) => {
    void reply.header('x-request-id', request.id);
    done();
  });
  app.get('/health', () => healthResponseSchema.parse({ status: 'ok', service: 'api' }));

  if (options.homeCms) {
    app.get('/api/v1/home', async (request, reply) => {
      try {
        return publicHomeResponseSchema.parse(await options.homeCms!.getPublicHome());
      } catch (error) {
        return sendCmsError(request, reply, error, 'Public home load failed');
      }
    });
  }

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

  if (options.homeCms && options.staffAuthorization) {
    const authorizeCms = async (request: FastifyRequest) => {
      const context = await options.staffAuthorization!.authenticate(request.headers.authorization);
      options.staffAuthorization!.requirePermission(context, HOME_CMS_PERMISSION);
      options.staffAuthorization!.requireDataScope(context, 'GLOBAL', null);
    };

    app.get('/api/v1/staff/cms/home', async (request, reply) => {
      try {
        await authorizeCms(request);
        return adminHomeResponseSchema.parse(await options.homeCms!.getAdminHome());
      } catch (error) {
        return sendCmsOrAuthError(request, reply, error, 'Staff CMS load failed');
      }
    });

    app.post('/api/v1/staff/cms/home/sections', async (request, reply) => {
      const input = createCmsSectionRequestSchema.safeParse(request.body);
      if (!input.success) return sendInvalidRequest(reply, request.id);
      try {
        await authorizeCms(request);
        return reply.status(201).send(await options.homeCms!.createSection(input.data));
      } catch (error) {
        return sendCmsOrAuthError(request, reply, error, 'Staff CMS create failed');
      }
    });

    app.patch('/api/v1/staff/cms/home/sections/:id', async (request, reply) => {
      const params = z.object({ id: z.uuid() }).safeParse(request.params);
      const input = updateCmsSectionRequestSchema.safeParse(request.body);
      if (!params.success || !input.success) return sendInvalidRequest(reply, request.id);
      try {
        await authorizeCms(request);
        return await options.homeCms!.updateSection(params.data.id, input.data);
      } catch (error) {
        return sendCmsOrAuthError(request, reply, error, 'Staff CMS update failed');
      }
    });

    app.put('/api/v1/staff/cms/home/sections/reorder', async (request, reply) => {
      const input = reorderCmsSectionsRequestSchema.safeParse(request.body);
      if (!input.success) return sendInvalidRequest(reply, request.id);
      try {
        await authorizeCms(request);
        return adminHomeResponseSchema.parse(await options.homeCms!.reorderSections(input.data));
      } catch (error) {
        return sendCmsOrAuthError(request, reply, error, 'Staff CMS reorder failed');
      }
    });

    app.patch('/api/v1/staff/cms/home/publication', async (request, reply) => {
      const input = updateCmsPageRequestSchema.safeParse(request.body);
      if (!input.success) return sendInvalidRequest(reply, request.id);
      try {
        await authorizeCms(request);
        return adminHomeResponseSchema.parse(
          await options.homeCms!.updatePagePublication(
            input.data.publicationState,
            input.data.version,
          ),
        );
      } catch (error) {
        return sendCmsOrAuthError(request, reply, error, 'Staff CMS publication update failed');
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

function sendCmsOrAuthError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
  message: string,
) {
  if (error instanceof ConsumerAuthError) return sendAuthError(request, reply, error, message);
  return sendCmsError(request, reply, error, message);
}

function sendCmsError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
  logMessage: string,
) {
  const statusCode =
    error instanceof CmsNotFoundError ? 404 : error instanceof CmsConflictError ? 409 : 500;
  const code =
    statusCode === 404 ? 'NOT_FOUND' : statusCode === 409 ? 'CONFLICT' : 'INTERNAL_ERROR';
  request.log.warn({ requestId: request.id, errorCode: code }, logMessage);
  return reply.status(statusCode).send(
    apiErrorResponseSchema.parse({
      error: {
        code,
        message:
          statusCode === 404
            ? 'CMS resource not found'
            : statusCode === 409
              ? 'CMS content changed; reload and retry'
              : 'Internal server error',
        requestId: request.id,
      },
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
    case 'NOT_FOUND':
      return 'Resource not found';
    case 'CONFLICT':
      return 'Resource conflict';
    case 'INTERNAL_ERROR':
      return 'Internal server error';
  }
}
