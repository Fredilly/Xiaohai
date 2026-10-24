import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { bookEditions, products, skus, type createDatabase } from '@xiaohai/db';
import { z } from 'zod';
import { MEIPING_PREFLIGHT_MAX_BYTES } from '@xiaohai/contracts/meiping';
import { ConsumerAuthError } from '../auth/errors.js';
import type { StaffAuthorizationService } from '../auth/staff-authorization.js';
import {
  inventoryPermissions,
  type InventoryOperationsService,
} from '../inventory/inventory-operations-service.js';
import type { StoreNetworkService } from '../stores/store-service.js';
import { buildMeipingPreflight } from './meiping-preflight.js';
import { parseMeipingWorkbook, sourceChecksum } from './meiping-xls.js';
import { MeipingReviewError, type MeipingReviewService } from './meiping-review-service.js';

const storeQuery = z.object({ storeId: z.uuid() }).strict();
const idParams = z.object({ id: z.uuid() });
const rowParams = z.object({ id: z.uuid(), sourceRowNumber: z.coerce.number().int().positive() });
const listQuery = storeQuery.extend({
  offset: z.coerce.number().int().nonnegative().max(1000000).default(0),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
const checksum = z.string().regex(/^[a-f0-9]{64}$/i);
const correctionBody = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    expectedChecksum: checksum,
    proposedFields: z
      .object({
        title: z.string().trim().min(1).max(200).optional(),
        author: z.string().trim().min(1).max(160).optional(),
        publisher: z.string().trim().min(1).max(160).optional(),
        barcode: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{4,64}$/)
          .optional(),
        priceMinor: z.number().int().min(0).max(2147483647).optional(),
      })
      .strict()
      .refine((fields) => Object.keys(fields).length > 0),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

const correctionReviewBody = z
  .object({
    expectedChecksum: checksum,
    expectedCorrectionVersion: z.number().int().positive(),
    verdict: z.enum(['ACCEPTED', 'REJECTED']),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

const decisionBody = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('CREATE_DRAFT'),
      sourceRowNumber: z.number().int().positive(),
      countedQuantity: z.number().int().min(0).max(2147483647),
      expectedVersion: z.number().int().nonnegative(),
      expectedChecksum: checksum,
    })
    .strict(),
  z
    .object({
      action: z.literal('EXCLUDE'),
      sourceRowNumber: z.number().int().positive(),
      reason: z.string().trim().min(1).max(500),
      expectedVersion: z.number().int().nonnegative(),
      expectedChecksum: checksum,
    })
    .strict(),
]);

export function registerMeipingReviewRoutes(
  app: FastifyInstance,
  options: {
    review: MeipingReviewService;
    staffAuthorization: StaffAuthorizationService;
    inventory: InventoryOperationsService;
    stores: StoreNetworkService;
    db: ReturnType<typeof createDatabase>['db'];
  },
) {
  const authorize = async (request: FastifyRequest, storeId: string) => {
    const actor = await options.staffAuthorization.authenticate(request.headers.authorization);
    options.staffAuthorization.requirePermission(actor, inventoryPermissions.receive);
    options.staffAuthorization.requirePermission(actor, inventoryPermissions.stocktake);
    await options.stores.getStaffStore(storeId, actor);
    await options.inventory.requireStoreAccess(actor, storeId);
    return { actorStaffAccountId: actor.staffAccountId, requestId: request.id };
  };

  const authorizeReviewRead = async (request: FastifyRequest, storeId: string) => {
    const actor = await options.staffAuthorization.authenticate(request.headers.authorization);
    const canEditReview =
      options.staffAuthorization.hasPermission(actor, inventoryPermissions.receive) &&
      options.staffAuthorization.hasPermission(actor, inventoryPermissions.stocktake);
    const canReviewCorrection = options.staffAuthorization.hasPermission(
      actor,
      'meiping.correction.review',
    );
    if (!canEditReview && !canReviewCorrection) {
      throw new ConsumerAuthError('STAFF_FORBIDDEN', 403);
    }
    await options.stores.getStaffStore(storeId, actor);
    await options.inventory.requireStoreAccess(actor, storeId);
    return { actorStaffAccountId: actor.staffAccountId, requestId: request.id };
  };

  const authorizeIndependentReviewer = async (request: FastifyRequest, storeId: string) => {
    const actor = await options.staffAuthorization.authenticate(request.headers.authorization);
    options.staffAuthorization.requirePermission(actor, 'meiping.correction.review');
    await options.stores.getStaffStore(storeId, actor);
    await options.inventory.requireStoreAccess(actor, storeId);
    return { actorStaffAccountId: actor.staffAccountId, requestId: request.id };
  };

  // This read-only list is scoped by the exact same Staff auth, RBAC and store checks
  // as the existing review create/read/write endpoints; no file upload required.
  app.get('/api/v1/staff/migrations/meiping/review-sessions', async (request, reply) => {
    const query = listQuery.safeParse(request.query);
    if (!query.success) return invalid(reply, request.id);
    try {
      await authorizeReviewRead(request, query.data.storeId);
      return await options.review.listSessions(
        query.data.storeId,
        query.data.offset,
        query.data.limit,
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  // XLS/XLSX parser was registered by registerMeipingXlsRoutes before this function.
  app.post(
    '/api/v1/staff/migrations/meiping/review-sessions',
    { bodyLimit: MEIPING_PREFLIGHT_MAX_BYTES },
    async (request, reply) => {
      const query = storeQuery.safeParse(request.query);
      if (!query.success || !Buffer.isBuffer(request.body)) return invalid(reply, request.id);
      try {
        const audit = await authorize(request, query.data.storeId);
        const parsed = parseMeipingWorkbook(request.body);
        const isbns = parsed.rows
          .map((row) => row.isbn)
          .filter((isbn): isbn is string => Boolean(isbn));
        const matches =
          isbns.length > 0
            ? await options.db
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
                )
            : [];
        const matchedIsbns = new Set(
          matches.map((row) => row.isbn).filter((isbn): isbn is string => Boolean(isbn)),
        );
        const matchedRowNumbers = new Set(
          parsed.rows
            .filter((row) => row.isbn && matchedIsbns.has(row.isbn))
            .map((row) => row.sourceRowNumber),
        );
        const store = await options.stores.getStaffStore(
          query.data.storeId,
          await options.staffAuthorization.authenticate(request.headers.authorization),
        );
        const report = buildMeipingPreflight(
          parsed.rows,
          { storeId: store.id, storeCode: store.code },
          { matchedRowNumbers, missingMappedFields: parsed.missingMappedFields },
        );
        report.sourceChecksum = sourceChecksum(request.body);
        return reply.status(201).send(await options.review.createSession(report, audit));
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  app.get('/api/v1/staff/migrations/meiping/review-sessions/:id', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const query = listQuery.safeParse(request.query);
    if (!params.success || !query.success) return invalid(reply, request.id);
    try {
      await authorizeReviewRead(request, query.data.storeId);
      return await options.review.listRows(
        params.data.id,
        query.data.storeId,
        query.data.offset,
        query.data.limit,
      );
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.put(
    '/api/v1/staff/migrations/meiping/review-sessions/:id/corrections/:sourceRowNumber',
    async (request, reply) => {
      const params = rowParams.safeParse(request.params);
      const query = storeQuery.safeParse(request.query);
      const body = correctionBody.safeParse(request.body);
      if (!params.success || !query.success || !body.success) return invalid(reply, request.id);
      try {
        const audit = await authorize(request, query.data.storeId);
        return await options.review.saveCorrection(
          params.data.id,
          query.data.storeId,
          params.data.sourceRowNumber,
          body.data,
          audit,
        );
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  app.post(
    '/api/v1/staff/migrations/meiping/review-sessions/:id/corrections/:sourceRowNumber/review',
    async (request, reply) => {
      const params = rowParams.safeParse(request.params);
      const query = storeQuery.safeParse(request.query);
      const body = correctionReviewBody.safeParse(request.body);
      if (!params.success || !query.success || !body.success) return invalid(reply, request.id);
      try {
        const reviewer = await authorizeIndependentReviewer(request, query.data.storeId);
        return await options.review.reviewCorrection(
          params.data.id,
          query.data.storeId,
          params.data.sourceRowNumber,
          body.data,
          reviewer,
        );
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  app.put(
    '/api/v1/staff/migrations/meiping/review-sessions/:id/decisions/:sourceRowNumber',
    async (request, reply) => {
      const params = rowParams.safeParse(request.params);
      const query = storeQuery.safeParse(request.query);
      const body = decisionBody.safeParse(request.body);
      if (!params.success || !query.success || !body.success) {
        return invalid(reply, request.id);
      }
      try {
        const audit = await authorize(request, query.data.storeId);
        return await options.review.saveDecision(
          params.data.id,
          query.data.storeId,
          params.data.sourceRowNumber,
          body.data,
          audit,
        );
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );
}

function invalid(reply: FastifyReply, requestId: string) {
  return reply.status(400).send({
    error: { code: 'INVALID_REQUEST', message: 'Invalid request', requestId },
  });
}

function fail(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof ConsumerAuthError) {
    return reply.status(error.statusCode).send({
      error: { code: error.code, message: 'Forbidden', requestId: request.id },
    });
  }
  if (error instanceof MeipingReviewError) {
    const status =
      error.code === 'NOT_FOUND'
        ? 404
        : error.code === 'SELF_REVIEW_FORBIDDEN'
          ? 403
          : error.code === 'CONFLICT' || error.code === 'BARCODE_NOT_VERIFIED'
            ? 409
            : 400;
    return reply.status(status).send({
      error: { code: error.code, message: 'Review not accepted', requestId: request.id },
    });
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN' || error.code === 'SCOPE_MISMATCH')
  ) {
    const status = error.code === 'NOT_FOUND' ? 404 : 403;
    return reply.status(status).send({
      error: { code: error.code, message: 'Not authorized', requestId: request.id },
    });
  }
  request.log.warn(
    { requestId: request.id, errorCode: 'MEIPING_REVIEW_FAILED' },
    'Review session request failed',
  );
  return reply.status(400).send({
    error: { code: 'INVALID_REVIEW', message: 'Review session rejected', requestId: request.id },
  });
}
