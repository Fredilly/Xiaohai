import type { LoggerOptions } from 'pino';

// Do not serialize raw requests or errors: their URLs, headers and provider payloads may contain PII.
export const safeLoggerOptions: LoggerOptions = {
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers.set-cookie',
      'req.headers.x-api-key',
      'res.headers.set-cookie',
      'headers.authorization',
      'headers.cookie',
      'headers.x-api-key',
      'password',
      'passwordHash',
      'token',
      'sessionToken',
      'session_key',
      'secret',
      'appSecret',
      'apiKey',
      'code',
      'openid',
      'openId',
      'body',
      'req.body',
      'query',
      'req.query',
      'prompt',
      'err',
      'error',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    req: (request: { id?: string; method?: string }) => ({
      id: request.id,
      method: request.method,
    }),
    res: (reply: { statusCode?: number }) => ({ statusCode: reply.statusCode }),
    err: () => '[REDACTED]',
    error: () => '[REDACTED]',
  },
};
