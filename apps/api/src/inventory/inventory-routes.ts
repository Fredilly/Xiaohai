import type { FastifyInstance, FastifyReply } from 'fastify';
import { publicInventoryQuerySchema } from '@xiaohai/contracts/inventory';
import type { InventorySearchService } from './inventory-service.js';

export function registerInventoryRoutes(
  app: FastifyInstance,
  options: { inventory: InventorySearchService },
) {
  app.get('/api/v1/inventory/books', async (request, reply) => {
    const input = publicInventoryQuerySchema.safeParse(request.query);
    if (!input.success) return invalid(reply, request.id);

    try {
      return await options.inventory.searchPublicBooks(input.data);
    } catch (error) {
      request.log.error(
        { requestId: request.id, errorCode: 'INVENTORY_SEARCH_FAILED', err: error },
        'Inventory search request failed',
      );
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          requestId: request.id,
        },
      });
    }
  });
}

function invalid(reply: FastifyReply, requestId: string) {
  return reply.status(400).send({
    error: { code: 'INVALID_REQUEST', message: 'Invalid request', requestId },
  });
}
