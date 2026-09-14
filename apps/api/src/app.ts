import Fastify, { type FastifyInstance } from 'fastify';
import { healthResponseSchema } from '@xiaohai/contracts';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true, requestIdHeader: 'x-request-id' });
  app.addHook('onSend', (request, reply, _payload, done) => {
    void reply.header('x-request-id', request.id);
    done();
  });
  app.get('/health', () => healthResponseSchema.parse({ status: 'ok', service: 'api' }));
  return app;
}
