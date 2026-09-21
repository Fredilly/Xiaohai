import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { createClient } from 'redis';

export interface RateLimitStore {
  consume(key: string, windowSeconds: number): Promise<number>;
  close?(): Promise<void>;
}

const incrementScript = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;

export class RedisRateLimitStore implements RateLimitStore {
  private readonly client;
  constructor(url: string) {
    this.client = createClient({ url });
    // A connection failure is handled by the request hook, which fails closed.
    this.client.on('error', () => undefined);
  }
  async consume(key: string, windowSeconds: number): Promise<number> {
    if (!this.client.isOpen) await this.client.connect();
    return Number(
      await this.client.eval(incrementScript, { keys: [key], arguments: [String(windowSeconds)] }),
    );
  }
  async close(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }
}

type Policy = { name: string; limit: number; windowSeconds: number };
export function ratePolicy(method: string, path: string): Policy | null {
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') return null;
  if (path === '/api/v1/auth/wechat/login' || path === '/api/v1/staff/auth/login')
    return { name: 'login', limit: 10, windowSeconds: 60 };
  if (path === '/api/v1/franchise/applications')
    return { name: 'public-submission', limit: 5, windowSeconds: 3600 };
  if (path.startsWith('/api/v1/ai/') || path.startsWith('/api/v1/staff/ai/'))
    return { name: 'ai-write', limit: 30, windowSeconds: 60 };
  if (path.startsWith('/api/v1/staff/admin/accounts/') && path.endsWith('/reset-password'))
    return { name: 'password-reset', limit: 5, windowSeconds: 3600 };
  return null;
}

export function registerAbuseControls(app: FastifyInstance, store: RateLimitStore): void {
  app.addHook('onRequest', async (request, reply) => {
    const policy = ratePolicy(request.method, request.url.split('?')[0] ?? '');
    if (!policy) return;
    // request.ip stays socket-derived unless Fastify is configured to trust the deployment proxy.
    const address = request.ip || 'unknown';
    const principal = createHash('sha256').update(address).digest('hex');
    const key = `xiaohai:security:limit:${policy.name}:${principal}`;
    let count: number;
    try {
      count = await store.consume(key, policy.windowSeconds);
    } catch {
      request.log.warn(
        { requestId: request.id, errorCode: 'RATE_LIMIT_UNAVAILABLE' },
        'Abuse control unavailable',
      );
      return reply.status(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Service temporarily unavailable',
          requestId: request.id,
        },
      });
    }
    if (count > policy.limit) {
      reply.header('retry-after', String(policy.windowSeconds));
      return reply.status(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many requests', requestId: request.id },
      });
    }
  });
}
