import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  inventoryPermissions,
  type InventoryOperationsService,
} from '../inventory/inventory-operations-service.js';
import { ConsumerAuthError } from '../auth/errors.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import type { StoreNetworkService } from '../stores/store-service.js';
import { and, eq, inArray } from 'drizzle-orm';
import { bookEditions, products, skus, type createDatabase } from '@xiaohai/db';
import { buildMeipingPreflight } from './meiping-preflight.js';
import { parseMeipingWorkbook, sourceChecksum } from './meiping-xls.js';

const querySchema = z
  .object({
    storeId: z.uuid(),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .strict();

export function registerMeipingXlsRoutes(
  app: FastifyInstance,
  options: {
    staffAuthorization: StaffAuthorizationService;
    stores: StoreNetworkService;
    inventory: InventoryOperationsService;
    db: ReturnType<typeof createDatabase>['db'];
  },
) {
  app.addContentTypeParser(
    [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream',
    ],
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );

  app.post('/api/v1/staff/migrations/meiping/preflight', async (request, reply) => {
    const query = querySchema.safeParse(request.query);
    if (!query.success || !Buffer.isBuffer(request.body)) return invalid(reply, request.id);
    try {
      const context = await options.staffAuthorization.authenticate(request.headers.authorization);
      options.staffAuthorization.requirePermission(context, inventoryPermissions.receive);
      const store = await options.stores.getStaffStore(query.data.storeId, context);
      // This is deliberately an authorization/read boundary. It does not stage or write data.
      await options.inventory.requireStoreAccess(context, query.data.storeId);
      const parsed = parseMeipingWorkbook(request.body);
      const isbns = parsed.rows
        .map((row) => row.isbn)
        .filter((isbn): isbn is string => Boolean(isbn));
      const matchedRowNumbers = new Set<number>();
      if (isbns.length > 0) {
        const matches = await options.db
          .select({ isbn: bookEditions.isbn })
          .from(bookEditions)
          .innerJoin(products, eq(products.bookEditionId, bookEditions.id))
          .innerJoin(skus, eq(skus.productId, products.id))
          .where(
            and(
              inArray(bookEditions.isbn, isbns),
              eq(products.status, 'ACTIVE'),
              eq(skus.status, 'ACTIVE'),
            ),
          );
        const matchedIsbns = new Set(
          matches.map((row) => row.isbn).filter((isbn): isbn is string => Boolean(isbn)),
        );
        for (const row of parsed.rows)
          if (row.isbn && matchedIsbns.has(row.isbn)) matchedRowNumbers.add(row.sourceRowNumber);
      }
      const report = buildMeipingPreflight(
        parsed.rows,
        {
          storeId: store.id,
          storeCode: store.code,
        },
        { matchedRowNumbers, missingMappedFields: parsed.missingMappedFields },
      );
      report.sourceChecksum = sourceChecksum(request.body);
      if (query.data.format === 'csv') {
        return reply
          .type('text/csv; charset=utf-8')
          .header('content-disposition', 'attachment; filename="meiping-exceptions.csv"')
          .send(report.exceptionReportCsv);
      }
      return reply.send({
        ...report,
        sheetName: parsed.sheetName,
        headers: parsed.headers,
        missingMappedFields: parsed.missingMappedFields,
      });
    } catch (error) {
      return fail(request, reply, error);
    }
  });
}

function invalid(reply: FastifyReply, requestId: string) {
  return reply.status(400).send({
    error: { code: 'INVALID_REQUEST', message: 'Invalid request', requestId },
  });
}

function fail(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof ConsumerAuthError) {
    return reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.statusCode === 401 ? 'Authentication required' : 'Forbidden',
        requestId: request.id,
      },
    });
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String(error.code);
    if (code === 'NOT_FOUND')
      return reply
        .status(404)
        .send({ error: { code, message: 'Not found', requestId: request.id } });
    if (code === 'SCOPE_MISMATCH')
      return reply
        .status(403)
        .send({ error: { code, message: 'Forbidden', requestId: request.id } });
  }
  request.log.warn(
    { requestId: request.id, errorCode: 'MEIPING_PREFLIGHT_FAILED' },
    'Meiping preflight failed',
  );
  return reply.status(400).send({
    error: {
      code: 'INVALID_WORKBOOK',
      message: 'Workbook could not be preflighted',
      requestId: request.id,
    },
  });
}
