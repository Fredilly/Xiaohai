import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  auditLogs,
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
          report: report as unknown as Record<string, unknown>,
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
      })),
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
      await tx.insert(auditLogs).values({
        actorStaffAccountId: audit.actorStaffAccountId,
        actionKey: 'meiping.review.decision.save',
        resourceType: 'MEIPING_REVIEW_SESSION',
        resourceId: id,
        requestId: audit.requestId,
        metadata: {
          storeId,
          sourceRowNumber,
          action: input.action,
          version: updated.version,
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
