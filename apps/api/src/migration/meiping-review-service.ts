import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  auditLogs,
  meipingReviewCorrections,
  meipingReviewDecisions,
  meipingReviewSessions,
  type createDatabase,
} from '@xiaohai/db';
import type { MeipingPreflightReport } from './meiping-preflight.js';
import { buildMeipingReviewPlan, type MeipingReviewDecision } from './meiping-import-readiness.js';

type Database = ReturnType<typeof createDatabase>['db'];

export class MeipingReviewError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_ROW') {
    super(code);
  }
}

export type MeipingReviewAuditContext = {
  actorStaffAccountId: string;
  requestId: string;
};

export type MeipingSavedDecision = MeipingReviewDecision & {
  expectedVersion: number;
  expectedChecksum: string;
};

export type MeipingCorrectionFields = Partial<{
  title: string;
  author: string;
  publisher: string;
  barcode: string;
  priceMinor: number;
}>;

export type MeipingCorrectionInput = {
  expectedVersion: number;
  expectedChecksum: string;
  proposedFields: MeipingCorrectionFields;
  reason: string;
};

export class MeipingReviewService {
  constructor(private readonly db: Database) {}

  /** The only side effects are isolated review staging and an auditable event. */
  async createSession(report: MeipingPreflightReport, audit: MeipingReviewAuditContext) {
    const checksum = report.sourceChecksum;
    if (
      !checksum ||
      checksum.length !== 64 ||
      report.inventoryApproval !== 'PENDING_ADMIN_REVIEW' ||
      report.totalRows < 1 ||
      report.rows.length !== report.totalRows
    ) {
      throw new MeipingReviewError('CONFLICT');
    }
    const result = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(meipingReviewSessions)
        .values({
          storeId: report.sourceStoreId,
          sourceChecksum: checksum,
          report,
          createdByStaffAccountId: audit.actorStaffAccountId,
        })
        .onConflictDoNothing({
          target: [meipingReviewSessions.storeId, meipingReviewSessions.sourceChecksum],
        })
        .returning({ id: meipingReviewSessions.id });
      if (created) {
        await tx.insert(auditLogs).values({
          actorStaffAccountId: audit.actorStaffAccountId,
          actionKey: 'meiping.review.session.create',
          resourceType: 'MEIPING_REVIEW_SESSION',
          resourceId: created.id,
          requestId: audit.requestId,
          metadata: {
            storeId: report.sourceStoreId,
            sourceChecksum: checksum,
            sourceRows: report.totalRows,
          },
        });
        return { id: created.id, created: true };
      }
      const [existing] = await tx
        .select({ id: meipingReviewSessions.id })
        .from(meipingReviewSessions)
        .where(
          and(
            eq(meipingReviewSessions.storeId, report.sourceStoreId),
            eq(meipingReviewSessions.sourceChecksum, checksum),
          ),
        )
        .limit(1);
      if (!existing) throw new MeipingReviewError('CONFLICT');
      return { id: existing.id, created: false };
    });
    return {
      ...result,
      status: 'DRAFT' as const,
      sourceChecksum: checksum,
      storeId: report.sourceStoreId,
      totalRows: report.totalRows,
      approved: false as const,
      catalogOrInventoryWritten: false as const,
    };
  }

  /** Only DRAFT summaries for the authorized store; no workbook content or inventory writes. */
  async listSessions(storeId: string, offset: number, limit: number) {
    const rows = await this.db
      .select({
        id: meipingReviewSessions.id,
        storeId: meipingReviewSessions.storeId,
        sourceChecksum: meipingReviewSessions.sourceChecksum,
        status: meipingReviewSessions.status,
        totalRows: sql<number>`(${meipingReviewSessions.report} ->> 'totalRows')::integer`,
        createdAt: meipingReviewSessions.createdAt,
      })
      .from(meipingReviewSessions)
      .where(
        and(eq(meipingReviewSessions.storeId, storeId), eq(meipingReviewSessions.status, 'DRAFT')),
      )
      .orderBy(desc(meipingReviewSessions.createdAt), desc(meipingReviewSessions.id))
      .limit(limit + 1)
      .offset(offset);
    const page = rows.slice(0, limit);
    const ids = page.map((row) => row.id);
    const counts =
      ids.length > 0
        ? await this.db
            .select({
              sessionId: meipingReviewDecisions.sessionId,
              savedDecisions: sql<number>`count(*)::integer`,
            })
            .from(meipingReviewDecisions)
            .where(inArray(meipingReviewDecisions.sessionId, ids))
            .groupBy(meipingReviewDecisions.sessionId)
        : [];
    const decisionCounts = new Map(counts.map((row) => [row.sessionId, row.savedDecisions]));
    return {
      storeId,
      offset,
      limit,
      hasMore: rows.length > limit,
      items: page.map((row) => ({
        id: row.id,
        storeId: row.storeId,
        sourceChecksum: row.sourceChecksum,
        status: 'DRAFT' as const,
        totalRows: row.totalRows,
        savedDecisions: decisionCounts.get(row.id) ?? 0,
        createdAt: row.createdAt.toISOString(),
        approved: false as const,
        catalogOrInventoryWritten: false as const,
      })),
    };
  }

  private async load(id: string, storeId: string) {
    const [session] = await this.db
      .select()
      .from(meipingReviewSessions)
      .where(and(eq(meipingReviewSessions.id, id), eq(meipingReviewSessions.storeId, storeId)))
      .limit(1);
    if (!session) throw new MeipingReviewError('NOT_FOUND');
    const report = session.report as unknown as MeipingPreflightReport;
    if (
      report.sourceStoreId !== session.storeId ||
      report.sourceChecksum !== session.sourceChecksum ||
      !Array.isArray(report.rows)
    ) {
      throw new MeipingReviewError('CONFLICT');
    }
    return { session, report };
  }

  async listRows(id: string, storeId: string, offset: number, limit: number) {
    const { session, report } = await this.load(id, storeId);
    const page = report.rows.slice(offset, offset + limit);
    const rowNumbers = page.map((row) => row.sourceRowNumber);
    const saved =
      rowNumbers.length > 0
        ? await this.db
            .select()
            .from(meipingReviewDecisions)
            .where(
              and(
                eq(meipingReviewDecisions.sessionId, id),
                inArray(meipingReviewDecisions.sourceRowNumber, rowNumbers),
              ),
            )
        : [];
    const corrections =
      rowNumbers.length > 0
        ? await this.db
            .select()
            .from(meipingReviewCorrections)
            .where(
              and(
                eq(meipingReviewCorrections.sessionId, id),
                inArray(meipingReviewCorrections.sourceRowNumber, rowNumbers),
              ),
            )
        : [];
    const correctionsByRow = new Map(corrections.map((item) => [item.sourceRowNumber, item]));
    const decisionsByRow = new Map(saved.map((item) => [item.sourceRowNumber, item]));
    return {
      sessionId: id,
      storeId: session.storeId,
      sourceChecksum: session.sourceChecksum,
      status: session.status,
      approved: false as const,
      catalogOrInventoryWritten: false as const,
      totalRows: report.totalRows,
      offset,
      limit,
      items: page.map((row) => ({
        sourceRowNumber: row.sourceRowNumber,
        disposition: row.disposition,
        sourceIdentifiers: row.sourceIdentifiers,
        normalized: row.normalized,
        issueCodes: row.issues.map((issue) => issue.code),
        saleBlocked: row.saleBlocked.length > 0,
        decision: decisionsByRow.get(row.sourceRowNumber) ?? null,
        correction: correctionsByRow.get(row.sourceRowNumber) ?? null,
      })),
    };
  }

  /**
   * Only stores a proposed fix for later independent verification. The original
   * report, row disposition, matching gate and formal stock are never changed.
   */
  async saveCorrection(
    id: string,
    storeId: string,
    sourceRowNumber: number,
    input: MeipingCorrectionInput,
    audit: MeipingReviewAuditContext,
  ) {
    const { session, report } = await this.load(id, storeId);
    if (session.status !== 'DRAFT' || session.sourceChecksum !== input.expectedChecksum) {
      throw new MeipingReviewError('CONFLICT');
    }
    if (!report.rows.some((row) => row.sourceRowNumber === sourceRowNumber)) {
      throw new MeipingReviewError('INVALID_ROW');
    }
    const fields = input.proposedFields;
    const keys = Object.keys(fields);
    const allowed = ['title', 'author', 'publisher', 'barcode', 'priceMinor'];
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 0 ||
      keys.length === 0 ||
      keys.some((key) => !allowed.includes(key)) ||
      !input.reason.trim() ||
      input.reason.length > 500
    ) {
      throw new MeipingReviewError('CONFLICT');
    }
    const clean: Record<string, string | number> = {};
    for (const key of keys) {
      const value = fields[key as keyof MeipingCorrectionFields];
      if (key === 'priceMinor') {
        if (
          typeof value !== 'number' ||
          !Number.isInteger(value) ||
          value < 0 ||
          value > 2147483647
        ) {
          throw new MeipingReviewError('CONFLICT');
        }
        clean[key] = value;
      } else {
        const limit = key === 'title' ? 200 : key === 'barcode' ? 64 : 160;
        if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) {
          throw new MeipingReviewError('CONFLICT');
        }
        const trimmed = value.trim();
        if (key === 'barcode' && !/^[A-Za-z0-9-]{4,64}$/.test(trimmed)) {
          throw new MeipingReviewError('CONFLICT');
        }
        clean[key] = trimmed;
      }
    }
    const updated = await this.db.transaction(async (tx) => {
      // Snapshot the old revision within the same transaction as the guarded
      // mutation and audit insert. A stale writer is rejected before history
      // is written; the optimistic UPDATE also protects a concurrent winner.
      const [previous] = await tx
        .select({
          proposedFields: meipingReviewCorrections.proposedFields,
          reason: meipingReviewCorrections.reason,
          version: meipingReviewCorrections.version,
        })
        .from(meipingReviewCorrections)
        .where(
          and(
            eq(meipingReviewCorrections.sessionId, id),
            eq(meipingReviewCorrections.sourceRowNumber, sourceRowNumber),
          ),
        )
        .limit(1);
      if (
        (input.expectedVersion === 0 && previous) ||
        (input.expectedVersion !== 0 && previous?.version !== input.expectedVersion)
      ) {
        throw new MeipingReviewError('CONFLICT');
      }
      const values = {
        proposedFields: clean,
        reason: input.reason.trim(),
        updatedByStaffAccountId: audit.actorStaffAccountId,
        updatedAt: new Date(),
      };
      let result: { version: number } | undefined;
      if (input.expectedVersion === 0) {
        [result] = await tx
          .insert(meipingReviewCorrections)
          .values({ sessionId: id, sourceRowNumber, ...values })
          .onConflictDoNothing()
          .returning({ version: meipingReviewCorrections.version });
      } else {
        [result] = await tx
          .update(meipingReviewCorrections)
          .set({ ...values, version: sql.raw('"version" + 1') })
          .where(
            and(
              eq(meipingReviewCorrections.sessionId, id),
              eq(meipingReviewCorrections.sourceRowNumber, sourceRowNumber),
              eq(meipingReviewCorrections.version, input.expectedVersion),
            ),
          )
          .returning({ version: meipingReviewCorrections.version });
      }
      if (!result) throw new MeipingReviewError('CONFLICT');
      await tx.insert(auditLogs).values({
        actorStaffAccountId: audit.actorStaffAccountId,
        actionKey: 'meiping.review.correction.save',
        resourceType: 'MEIPING_REVIEW_SESSION',
        resourceId: id,
        requestId: audit.requestId,
        metadata: {
          sessionId: id,
          storeId,
          sourceChecksum: session.sourceChecksum,
          sourceRowNumber,
          expectedVersion: input.expectedVersion,
          previous: previous
            ? {
                proposedFields: previous.proposedFields,
                reason: previous.reason,
                version: previous.version,
              }
            : null,
          next: {
            proposedFields: clean,
            reason: values.reason,
            version: result.version,
          },
          // Complete, protected audit-store snapshots. Actor, timestamp and
          // request ID are held in audit_logs columns. Never echo this
          // metadata into application logs or ordinary API responses.
        },
      });
      return result;
    });
    return {
      sourceRowNumber,
      version: updated.version,
      status: 'PENDING_VERIFICATION' as const,
      approved: false as const,
      catalogOrInventoryWritten: false as const,
    };
  }

  async saveDecision(
    id: string,
    storeId: string,
    sourceRowNumber: number,
    input: MeipingSavedDecision,
    audit: MeipingReviewAuditContext,
  ) {
    const { session, report } = await this.load(id, storeId);
    if (session.sourceChecksum !== input.expectedChecksum) {
      throw new MeipingReviewError('CONFLICT');
    }
    const row = report.rows.find((item) => item.sourceRowNumber === sourceRowNumber);
    if (!row || input.sourceRowNumber !== sourceRowNumber) {
      throw new MeipingReviewError('INVALID_ROW');
    }
    if (input.action === 'CREATE_DRAFT') {
      // Reapply the pure #146 gate to the persisted server-derived row snapshot.
      const singleRowReport: MeipingPreflightReport = {
        ...report,
        rows: [row],
        totalRows: 1,
      };
      const plan = buildMeipingReviewPlan(singleRowReport, {
        storeId,
        expectedChecksum: session.sourceChecksum,
        decisions: [
          {
            sourceRowNumber,
            action: 'CREATE_DRAFT',
            countedQuantity: input.countedQuantity,
          },
        ],
      });
      if (plan.status !== 'REVIEW_INPUT_COMPLETE') {
        throw new MeipingReviewError('CONFLICT');
      }
    } else if (!input.reason.trim()) {
      throw new MeipingReviewError('CONFLICT');
    }
    const result = await this.db.transaction(async (tx) => {
      // Capture the preceding persisted value before a version-checked mutation.
      // A concurrent update can win between the SELECT and UPDATE, but then
      // the expected-version predicate prevents a stale history entry.
      const [previous] = await tx
        .select({
          action: meipingReviewDecisions.action,
          countedQuantity: meipingReviewDecisions.countedQuantity,
          reason: meipingReviewDecisions.reason,
          version: meipingReviewDecisions.version,
        })
        .from(meipingReviewDecisions)
        .where(
          and(
            eq(meipingReviewDecisions.sessionId, id),
            eq(meipingReviewDecisions.sourceRowNumber, sourceRowNumber),
          ),
        )
        .limit(1);
      if (
        (input.expectedVersion === 0 && previous) ||
        (input.expectedVersion !== 0 && previous?.version !== input.expectedVersion)
      ) {
        throw new MeipingReviewError('CONFLICT');
      }
      const values = {
        action: input.action,
        countedQuantity: input.action === 'CREATE_DRAFT' ? input.countedQuantity : null,
        reason: input.action === 'EXCLUDE' ? input.reason.trim() : null,
        updatedByStaffAccountId: audit.actorStaffAccountId,
        updatedAt: new Date(),
      };
      let updated: { version: number } | undefined;
      if (input.expectedVersion === 0) {
        [updated] = await tx
          .insert(meipingReviewDecisions)
          .values({ sessionId: id, sourceRowNumber, ...values })
          .onConflictDoNothing()
          .returning({ version: meipingReviewDecisions.version });
      } else {
        [updated] = await tx
          .update(meipingReviewDecisions)
          .set({ ...values, version: sql.raw('"version" + 1') })
          .where(
            and(
              eq(meipingReviewDecisions.sessionId, id),
              eq(meipingReviewDecisions.sourceRowNumber, sourceRowNumber),
              eq(meipingReviewDecisions.version, input.expectedVersion),
            ),
          )
          .returning({ version: meipingReviewDecisions.version });
      }
      if (!updated) throw new MeipingReviewError('CONFLICT');
      // An append-only audit event with complete before/after snapshots is
      // persisted in the same transaction as the mutable current decision.
      // A failed/stale mutation rolls back without producing a history entry.
      const before = previous
        ? {
            action: previous.action,
            countedQuantity: previous.countedQuantity,
            reason: previous.reason,
            version: previous.version,
          }
        : null;
      const after = {
        action: values.action,
        countedQuantity: values.countedQuantity,
        reason: values.reason,
        version: updated.version,
      };
      await tx.insert(auditLogs).values({
        actorStaffAccountId: audit.actorStaffAccountId,
        actionKey: 'meiping.review.decision.save',
        resourceType: 'MEIPING_REVIEW_SESSION',
        resourceId: id,
        requestId: audit.requestId,
        metadata: {
          sessionId: id,
          storeId,
          sourceChecksum: session.sourceChecksum,
          sourceRowNumber,
          expectedVersion: input.expectedVersion,
          previous: before,
          next: after,
          // Actor, request ID and timestamp are stored in dedicated audit_logs
          // columns (actorStaffAccountId, requestId, createdAt).
        },
      });
      return updated;
    });
    return {
      sourceRowNumber,
      action: input.action,
      version: result.version,
      approved: false as const,
      catalogOrInventoryWritten: false as const,
    };
  }
}
