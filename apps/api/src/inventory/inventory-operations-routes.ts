import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  createGoodsReceiptRequestSchema,
  createPurchaseOrderRequestSchema,
  createStocktakeRequestSchema,
  createStockTransferRequestSchema,
  inventoryAdjustmentRequestSchema,
  inventoryListQuerySchema,
  inventoryMutationRequestSchema,
  purchaseOrderActionSchema,
  stocktakeActionSchema,
  stocktakeCountRequestSchema,
  stockTransferActionSchema,
  supplierInputSchema,
  updateSupplierRequestSchema,
} from '@xiaohai/contracts/inventory';
import { ConsumerAuthError } from '../auth/errors.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import {
  InventoryOperationsError,
  inventoryPermissions,
  type InventoryOperationsService,
} from './inventory-operations-service.js';

const idParams = z.object({ id: z.uuid() });
const storeParams = z.object({ storeId: z.uuid() });

export function registerInventoryOperationsRoutes(
  app: FastifyInstance,
  options: {
    operations: InventoryOperationsService;
    staffAuthorization: StaffAuthorizationService;
  },
) {
  const auth = async (request: FastifyRequest, permission: string) => {
    const context = await options.staffAuthorization.authenticate(request.headers.authorization);
    options.staffAuthorization.requirePermission(context, permission);
    return context;
  };
  app.get('/api/v1/staff/inventory', async (request, reply) => {
    const input = inventoryListQuerySchema.safeParse(request.query);
    if (!input.success) return invalid(reply, request.id);
    try {
      return await options.operations.listInventory(
        await auth(request, inventoryPermissions.read),
        input.data,
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.get('/api/v1/staff/inventory/stores/:storeId/transactions', async (request, reply) => {
    const params = storeParams.safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);
    try {
      return await options.operations.listTransactions(
        await auth(request, inventoryPermissions.read),
        params.data.storeId,
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.get('/api/v1/staff/inventory/stores/:storeId/alerts', async (request, reply) => {
    const params = storeParams.safeParse(request.params);
    const query = z
      .object({ threshold: z.coerce.number().int().nonnegative().max(10000).default(5) })
      .strict()
      .safeParse(request.query);
    if (!params.success || !query.success) return invalid(reply, request.id);
    try {
      return await options.operations.listAlerts(
        await auth(request, inventoryPermissions.read),
        params.data.storeId,
        query.data.threshold,
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.post('/api/v1/staff/inventory/issues', async (request, reply) => {
    const input = inventoryMutationRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      return reply
        .status(201)
        .send(
          await options.operations.issue(
            await auth(request, inventoryPermissions.issue),
            input.data,
          ),
        );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.post('/api/v1/staff/inventory/adjustments', async (request, reply) => {
    const input = inventoryAdjustmentRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      return reply
        .status(201)
        .send(
          await options.operations.adjust(
            await auth(request, inventoryPermissions.adjust),
            input.data,
          ),
        );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get('/api/v1/staff/inventory/suppliers', async (request, reply) => {
    try {
      await auth(request, inventoryPermissions.procurement);
      return await options.operations.listSuppliers();
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.post('/api/v1/staff/inventory/suppliers', async (request, reply) => {
    const input = supplierInputSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      const context = await auth(request, inventoryPermissions.procurement);
      options.staffAuthorization.requireDataScope(context, 'GLOBAL', null);
      return reply.status(201).send(await options.operations.createSupplier(input.data));
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.patch('/api/v1/staff/inventory/suppliers/:id', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const input = updateSupplierRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      const context = await auth(request, inventoryPermissions.procurement);
      options.staffAuthorization.requireDataScope(context, 'GLOBAL', null);
      return await options.operations.updateSupplier(params.data.id, input.data);
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.post('/api/v1/staff/inventory/purchase-orders', async (request, reply) => {
    const input = createPurchaseOrderRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      return reply
        .status(201)
        .send(
          await options.operations.createPurchaseOrder(
            await auth(request, inventoryPermissions.procurement),
            input.data,
          ),
        );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.post('/api/v1/staff/inventory/purchase-orders/:id/actions', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const input = purchaseOrderActionSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      return await options.operations.actOnPurchaseOrder(
        await auth(request, inventoryPermissions.procurement),
        params.data.id,
        input.data.action,
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.post('/api/v1/staff/inventory/goods-receipts', async (request, reply) => {
    const input = createGoodsReceiptRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      return reply
        .status(201)
        .send(
          await options.operations.createReceipt(
            await auth(request, inventoryPermissions.receive),
            input.data,
          ),
        );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.post('/api/v1/staff/inventory/goods-receipts/:id/post', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return invalid(reply, request.id);
    try {
      return await options.operations.postReceipt(
        await auth(request, inventoryPermissions.receive),
        params.data.id,
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.post('/api/v1/staff/inventory/stocktakes', async (request, reply) => {
    const input = createStocktakeRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      return reply
        .status(201)
        .send(
          await options.operations.createStocktake(
            await auth(request, inventoryPermissions.stocktake),
            input.data,
          ),
        );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.put('/api/v1/staff/inventory/stocktakes/:id/counts', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const input = stocktakeCountRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      return await options.operations.countStocktake(
        await auth(request, inventoryPermissions.stocktake),
        params.data.id,
        input.data,
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.post('/api/v1/staff/inventory/stocktakes/:id/actions', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const input = stocktakeActionSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      return await options.operations.actOnStocktake(
        await auth(request, inventoryPermissions.stocktake),
        params.data.id,
        input.data.action,
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.post('/api/v1/staff/inventory/transfers', async (request, reply) => {
    const input = createStockTransferRequestSchema.safeParse(request.body);
    if (!input.success) return invalid(reply, request.id);
    try {
      return reply
        .status(201)
        .send(
          await options.operations.createTransfer(
            await auth(request, inventoryPermissions.transfer),
            input.data,
          ),
        );
    } catch (error) {
      return fail(request, reply, error);
    }
  });
  app.post('/api/v1/staff/inventory/transfers/:id/actions', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const input = stockTransferActionSchema.safeParse(request.body);
    if (!params.success || !input.success) return invalid(reply, request.id);
    try {
      return await options.operations.actOnTransfer(
        await auth(request, inventoryPermissions.transfer),
        params.data.id,
        input.data.action,
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
  if (error instanceof ConsumerAuthError)
    return reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.statusCode === 401 ? 'Authentication required' : 'Forbidden',
        requestId: request.id,
      },
    });
  if (error instanceof InventoryOperationsError) {
    const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403 : 409;
    return reply.status(status).send({
      error: {
        code: error.code,
        message: error.code.replaceAll('_', ' ').toLowerCase(),
        requestId: request.id,
      },
    });
  }
  request.log.error(
    { requestId: request.id, errorCode: 'INVENTORY_OPERATION_FAILED', err: error },
    'Inventory operation failed',
  );
  return reply.status(500).send({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: request.id },
  });
}
