import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  auditLogs,
  bookEditions,
  skus,
  meipingCorrectionReviews,
  meipingReviewCorrectionHistory,
  meipingReviewDecisionHistory,
  meipingReviewCorrections,
  meipingReviewDecisions,
  meipingReviewSessions,
  type createDatabase,
} from '@xiaohai/db';
import type { MeipingPreflightReport } from './meiping-preflight.js';
import { buildMeipingReviewPlan, type MeipingReviewDecision } from './meiping-import-readiness.js';

type Database = ReturnType<typeof createDatabase>['db'];

export class MeipingReviewError extends Error {
  constructor(
    readonly code:
      'NOT_FOUND' | 'CONFLICT' | 'INVALID_ROW' | 'SELF_REVIEW_FORBIDDEN' | 'BARCODE_NOT_VERIFIED',
  ) {
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

export type MeipingCorrectionReviewInput = {
  expectedChecksum: string;
  expectedCorrectionVersion: number;
  verdict: 'ACCEPTED' | 'REJECTED';
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
    const decisionHistory =
      rowNumbers.length > 0
        ? await this.db
            .select()
            .from(meipingReviewDecisionHistory)
            .where(
              and(
                eq(meipingReviewDecisionHistory.sessionId, id),
                inArray(meipingReviewDecisionHistory.sourceRowNumber, rowNumbers),
              ),
            )
        : [];
    const correctionHistory =
      rowNumbers.length > 0
        ? await this.db
            .select()
            .from(meipingReviewCorrectionHistory)
            .where(
              and(
                eq(meipingReviewCorrectionHistory.sessionId, id),
                inArray(meipingReviewCorrectionHistory.sourceRowNumber, rowNumbers),
              ),
            )
        : [];
    const reviewed =
      rowNumbers.length > 0
        ? await this.db
            .select()
            .from(meipingCorrectionReviews)
            .where(
              and(
                eq(meipingCorrectionReviews.sessionId, id),
                inArray(meipingCorrectionReviews.sourceRowNumber, rowNumbers),
              ),
            )
        : [];
    const activeReview = new Map(
      reviewed.map((item) => [item.sourceRowNumber + ':' + item.correctionVersion, item]),
    );
    const correctionsByRow = new Map(corrections.map((item) => [item.sourceRowNumber, item]));
    const decisionsByRow = new Map(saved.map((item) => [item.sourceRowNumber, item]));
    const decisionHistoryByRow = new Map<number, typeof decisionHistory>();
    for (const item of decisionHistory) {
      const history = decisionHistoryByRow.get(item.sourceRowNumber) ?? [];
      history.push(item);
      decisionHistoryByRow.set(item.sourceRowNumber, history);
    }
    const correctionHistoryByRow = new Map<number, typeof correctionHistory>();
    for (const item of correctionHistory) {
      const history = correctionHistoryByRow.get(item.sourceRowNumber) ?? [];
      history.push(item);
      correctionHistoryByRow.set(item.sourceRowNumber, history);
    }
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
        decisionHistory: (decisionHistoryByRow.get(row.sourceRowNumber) ?? []).map((item) => ({
          sourceRowNumber: item.sourceRowNumber,
          action: item.action,
          countedQuantity: item.countedQuantity,
          reason: item.reason,
          version: item.version,
          updatedAt: item.updatedAt,
          capturedAt: item.capturedAt,
        })),
        correction: correctionsByRow.get(row.sourceRowNumber) ?? null,
        correctionHistory: (correctionHistoryByRow.get(row.sourceRowNumber) ?? []).map((item) => ({
          sourceRowNumber: item.sourceRowNumber,
          proposedFields: item.proposedFields,
          reason: item.reason,
          version: item.version,
          updatedAt: item.updatedAt,
          capturedAt: item.capturedAt,
        })),
        correctionReview:
          activeReview.get(
            row.sourceRowNumber + ':' + (correctionsByRow.get(row.sourceRowNumber)?.version ?? 0),
          ) ?? null,
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
      await tx
        .insert(meipingReviewCorrectionHistory)
        .values({
          sessionId: id,
          sourceRowNumber,
          proposedFields: clean,
          reason: input.reason.trim(),
          version: result.version,
          updatedByStaffAccountId: audit.actorStaffAccountId,
          updatedAt: values.updatedAt,
        })
        .onConflictDoNothing();
      await tx.insert(auditLogs).values({
        actorStaffAccountId: audit.actorStaffAccountId,
        actionKey: 'meiping.review.correction.save',
        resourceType: 'MEIPING_REVIEW_SESSION',
        resourceId: id,
        requestId: audit.requestId,
        metadata: {
          storeId,
          sourceRowNumber,
          version: result.version,
          proposedFieldNames: Object.keys(clean),
          // Never log raw proposed values, barcode, or reason in audit metadata.
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

  /**
   * Review is immutable and bound to one correction version; it NEVER resolves
   * original row issues, authorizes import, or touches catalog/stock.
   */
  async reviewCorrection(
    id: string,
    storeId: string,
    sourceRowNumber: number,
    input: MeipingCorrectionReviewInput,
    audit: MeipingReviewAuditContext,
  ) {
    const { session, report } = await this.load(id, storeId);
    if (
      session.status !== 'DRAFT' ||
      input.expectedChecksum !== session.sourceChecksum ||
      !Number.isSafeInteger(input.expectedCorrectionVersion) ||
      input.expectedCorrectionVersion < 1 ||
      !['ACCEPTED', 'REJECTED'].includes(input.verdict) ||
      !input.reason.trim() ||
      input.reason.length > 500
    )
      throw new MeipingReviewError('CONFLICT');
    const row = report.rows.find((item) => item.sourceRowNumber === sourceRowNumber);
    if (!row) throw new MeipingReviewError('INVALID_ROW');

    const result = await this.db.transaction(async (tx) => {
      // Lock this proposal so concurrent edits cannot change its version during review.
      const [current] = await tx
        .select()
        .from(meipingReviewCorrections)
        .where(
          and(
            eq(meipingReviewCorrections.sessionId, id),
            eq(meipingReviewCorrections.sourceRowNumber, sourceRowNumber),
          ),
        )
        .for('update')
        .limit(1);
      if (!current || current.version !== input.expectedCorrectionVersion) {
        throw new MeipingReviewError('CONFLICT');
      }
      if (current.updatedByStaffAccountId === audit.actorStaffAccountId) {
        throw new MeipingReviewError('SELF_REVIEW_FORBIDDEN');
      }
      if (input.verdict === 'ACCEPTED') {
        const fields = current.proposedFields as MeipingCorrectionFields;
        if (typeof fields.barcode === 'string') {
          const barcode = fields.barcode.trim();
          // Conservative pre-check only: not proof of final uniqueness in future imports.
          const collisionInSource = report.rows.some(
            (other) =>
              other.sourceRowNumber !== sourceRowNumber &&
              (other.sourceIdentifiers.barcode === barcode ||
                other.sourceIdentifiers.isbn === barcode),
          );
          if (collisionInSource) throw new MeipingReviewError('BARCODE_NOT_VERIFIED');
          const [skuMatch, editionMatch] = await Promise.all([
            tx.select({ id: skus.id }).from(skus).where(eq(skus.code, barcode)).limit(1),
            tx
              .select({ id: bookEditions.id })
              .from(bookEditions)
              .where(eq(bookEditions.isbn, barcode))
              .limit(1),
          ]);
          if (skuMatch.length || editionMatch.length) {
            throw new MeipingReviewError('BARCODE_NOT_VERIFIED');
          }
          const previouslyAccepted = await tx
            .select({ proposedFields: meipingReviewCorrections.proposedFields })
            .from(meipingCorrectionReviews)
            .innerJoin(
              meipingReviewCorrections,
              and(
                eq(meipingCorrectionReviews.sessionId, meipingReviewCorrections.sessionId),
                eq(
                  meipingCorrectionReviews.sourceRowNumber,
                  meipingReviewCorrections.sourceRowNumber,
                ),
                eq(meipingCorrectionReviews.correctionVersion, meipingReviewCorrections.version),
              ),
            )
            .where(
              and(
                eq(meipingCorrectionReviews.verdict, 'ACCEPTED'),
                eq(meipingCorrectionReviews.sessionId, id),
              ),
            );
          if (previouslyAccepted.some((entry) => entry.proposedFields.barcode === barcode)) {
            throw new MeipingReviewError('BARCODE_NOT_VERIFIED');
          }
        } else if (
          row.blockingIssues.some((issue) =>
            ['BARCODE_CONFLICT', 'DUPLICATE_BARCODE'].includes(issue.code),
          )
        ) {
          throw new MeipingReviewError('BARCODE_NOT_VERIFIED');
        }
      }
      const [inserted] = await tx
        .insert(meipingCorrectionReviews)
        .values({
          sessionId: id,
          sourceRowNumber,
          correctionVersion: current.version,
          verdict: input.verdict,
          reason: input.reason.trim(),
          reviewedByStaffAccountId: audit.actorStaffAccountId,
        })
        .onConflictDoNothing()
        .returning({
          correctionVersion: meipingCorrectionReviews.correctionVersion,
        });
      if (!inserted) throw new MeipingReviewError('CONFLICT');
      await tx.insert(auditLogs).values({
        actorStaffAccountId: audit.actorStaffAccountId,
        actionKey: 'meiping.review.correction.verdict',
        resourceType: 'MEIPING_REVIEW_SESSION',
        resourceId: id,
        requestId: audit.requestId,
        metadata: {
          storeId,
          sourceRowNumber,
          correctionVersion: current.version,
          verdict: input.verdict,
        },
        // No raw proposed fields or reviewer free-text reason in the audit metadata.
      });
      return inserted;
    });
    return {
      sourceRowNumber,
      correctionVersion: result.correctionVersion,
      verdict: input.verdict,
      correctionAcceptedForLaterReview: input.verdict === 'ACCEPTED',
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
      await tx
        .insert(meipingReviewDecisionHistory)
        .values({
          sessionId: id,
          sourceRowNumber,
          action: values.action,
          countedQuantity: values.countedQuantity,
          reason: values.reason,
          version: updated.version,
          updatedByStaffAccountId: audit.actorStaffAccountId,
          updatedAt: values.updatedAt,
        })
        .onConflictDoNothing();
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
