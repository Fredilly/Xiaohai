import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import {
  auditLogs,
  books,
  createDatabase,
  meipingReviewDecisions,
  meipingReviewCorrections,
  meipingCorrectionReviews,
  meipingReviewSessions,
  regions,
  staffAccounts,
  storeInventory,
  stores,
} from '@xiaohai/db';
import type {
  MeipingPreflightReport,
  MeipingPreflightRow,
} from '../src/migration/meiping-preflight.js';
import {
  MeipingReviewError,
  MeipingReviewService,
} from '../src/migration/meiping-review-service.js';

const databaseUrl = process.env.DATABASE_URL;
// Never run mutating integration fixtures against a development or production DB.
const database =
  databaseUrl && /^xiaohai_(test|pr147_review_test)$/.test(new URL(databaseUrl).pathname.slice(1))
    ? createDatabase(process.env)
    : null;
const suite = database ? describe : describe.skip;
const checksum = 'a'.repeat(64);

suite('Meiping review staging PostgreSQL integration', () => {
  const review = new MeipingReviewService(database!.db);
  const actorIds: string[] = [];
  const regionIds: string[] = [];
  const storeIds: string[] = [];

  afterAll(async () => {
    if (!database) return;
    try {
      if (storeIds.length > 0) {
        const sessions = await database.db
          .select({ id: meipingReviewSessions.id })
          .from(meipingReviewSessions)
          .where(inArray(meipingReviewSessions.storeId, storeIds));
        const sessionIds = sessions.map((session) => session.id);
        if (sessionIds.length > 0) {
          await database.db
            .delete(meipingCorrectionReviews)
            .where(inArray(meipingCorrectionReviews.sessionId, sessionIds));
          await database.db
            .delete(meipingReviewCorrections)
            .where(inArray(meipingReviewCorrections.sessionId, sessionIds));
          await database.db
            .delete(meipingReviewDecisions)
            .where(inArray(meipingReviewDecisions.sessionId, sessionIds));
          await database.db
            .delete(auditLogs)
            .where(
              and(
                eq(auditLogs.resourceType, 'MEIPING_REVIEW_SESSION'),
                inArray(auditLogs.resourceId, sessionIds),
              ),
            );
          await database.db
            .delete(meipingReviewSessions)
            .where(inArray(meipingReviewSessions.id, sessionIds));
        }
        await database.db.delete(stores).where(inArray(stores.id, storeIds));
      }
      if (regionIds.length > 0) {
        await database.db.delete(regions).where(inArray(regions.id, regionIds));
      }
      if (actorIds.length > 0) {
        await database.db.delete(staffAccounts).where(inArray(staffAccounts.id, actorIds));
      }
    } finally {
      await database.pool.end();
    }
  });

  async function fixture() {
    const suffix = randomUUID().slice(0, 8);
    const [actor] = await database!.db
      .insert(staffAccounts)
      .values({ loginIdentifier: 'review-' + suffix, passwordHash: 'test-only' })
      .returning({ id: staffAccounts.id });
    actorIds.push(actor!.id);
    const [region] = await database!.db
      .insert(regions)
      .values({
        code: 'REVIEW-R-' + suffix,
        name: 'Test Region',
        countryCode: 'CN',
        countryName: 'China',
      })
      .returning({ id: regions.id });
    regionIds.push(region!.id);
    const [store] = await database!.db
      .insert(stores)
      .values({
        regionId: region!.id,
        code: 'REVIEW-S-' + suffix,
        name: 'Review-only test store',
        countryCode: 'CN',
        countryName: 'China',
        city: 'Chengdu',
        timezone: 'Asia/Shanghai',
        addressLine: 'Disposable test',
        latitude: 30.5,
        longitude: 104.0,
      })
      .returning({ id: stores.id });
    storeIds.push(store!.id);
    const sourceRowNumber = 2;
    const warning = {
      sourceRowNumber,
      code: 'AUTHOR_MISSING',
      severity: 'WARNING' as const,
      message: 'Metadata missing',
    };
    const row: MeipingPreflightRow = {
      sourceRowNumber,
      rawColumns: { 商品名称: '测试绘本' },
      sourceCategory: '图书',
      sourceCategoryType: 'BOOK',
      sourceIdentifiers: {
        bookCode: 'B-TEST',
        internalCode: null,
        barcode: '69000001234',
        isbn: null,
      },
      normalized: { title: '测试绘本', author: null, publisher: null, priceMinor: 3200 },
      plannedInventory: 1,
      inventoryBasis: 'ASSUMED_PENDING_STOCKTAKE',
      matchStatus: 'UNMATCHED_REVIEW',
      disposition: 'CREATE_CANDIDATE',
      issues: [warning],
      metadataWarnings: [warning],
      blockingIssues: [],
      saleBlocked: [],
    };
    const report: MeipingPreflightReport = {
      sourceType: 'MEIPING_XLS',
      sourceChecksum: checksum,
      sourceStoreId: store!.id,
      sourceStoreCode: 'TEST-ONLY',
      inventoryApproval: 'PENDING_ADMIN_REVIEW',
      totalRows: 1,
      matchedRows: 0,
      createCandidateRows: 1,
      exceptionRows: 0,
      metadataWarningRows: 1,
      blockingRows: 0,
      saleBlockedRows: 0,
      assumedInventoryRows: 1,
      plannedInventoryTotal: 1,
      rows: [row],
      exceptionReportCsv: '',
    };
    return { actorId: actor!.id, storeId: store!.id, report };
  }

  it('lists only current-store drafts with saved-decision counts, without workbook data or writes', async () => {
    const first = await fixture();
    const second = await fixture();
    const auditA = { actorStaffAccountId: first.actorId, requestId: randomUUID() };
    const auditB = { actorStaffAccountId: second.actorId, requestId: randomUUID() };
    const [catalogBefore, stockBefore] = await Promise.all([
      database!.db.select().from(books),
      database!.db.select().from(storeInventory),
    ]);
    const a = await review.createSession(first.report, auditA);
    const b = await review.createSession(second.report, auditB);
    await review.saveDecision(
      a.id,
      first.storeId,
      2,
      {
        action: 'CREATE_DRAFT',
        sourceRowNumber: 2,
        countedQuantity: 0,
        expectedVersion: 0,
        expectedChecksum: checksum,
      },
      auditA,
    );
    const listA = await review.listSessions(first.storeId, 0, 20);
    expect(listA).toMatchObject({ storeId: first.storeId, offset: 0, limit: 20, hasMore: false });
    expect(listA.items).toHaveLength(1);
    expect(listA.items[0]).toMatchObject({
      id: a.id,
      status: 'DRAFT',
      savedDecisions: 1,
      totalRows: 1,
      approved: false,
      catalogOrInventoryWritten: false,
    });
    expect(JSON.stringify(listA)).not.toContain('rawColumns');
    expect(JSON.stringify(listA)).not.toContain('测试绘本');
    const listB = await review.listSessions(second.storeId, 0, 20);
    expect(listB.items.map((row) => row.id)).toEqual([b.id]);
    const afterLast = await review.listSessions(first.storeId, 1, 20);
    expect(afterLast.items).toHaveLength(0);
    expect((await database!.db.select().from(books)).length).toBe(catalogBefore.length);
    expect((await database!.db.select().from(storeInventory)).length).toBe(stockBefore.length);
  });

  it('enforces independent reviewer, immutable verdict version and preserves catalog/stock', async () => {
    const { actorId, storeId, report } = await fixture();
    const author = { actorStaffAccountId: actorId, requestId: randomUUID() };
    const [reviewer] = await database!.db
      .insert(staffAccounts)
      .values({
        loginIdentifier: 'reviewer-' + randomUUID().slice(0, 8),
        passwordHash: 'test-only',
      })
      .returning({ id: staffAccounts.id });
    actorIds.push(reviewer!.id);
    const independent = { actorStaffAccountId: reviewer!.id, requestId: randomUUID() };
    const session = await review.createSession(report, author);
    const [beforeBooks, beforeInventory] = await Promise.all([
      database!.db.select().from(books),
      database!.db.select().from(storeInventory),
    ]);
    await review.saveCorrection(
      session.id,
      storeId,
      2,
      {
        expectedChecksum: checksum,
        expectedVersion: 0,
        proposedFields: { author: '待复核作者', barcode: 'PR153-UNIQUE-001' },
        reason: '人工核对纸质书',
      },
      author,
    );
    const proposal = {
      expectedChecksum: checksum,
      expectedCorrectionVersion: 1,
      verdict: 'ACCEPTED' as const,
      reason: '核对原书封底信息，记录建议待下游审核',
    };
    await expect(review.reviewCorrection(session.id, storeId, 2, proposal, author)).rejects.toThrow(
      MeipingReviewError,
    );
    await expect(
      review.reviewCorrection(
        session.id,
        storeId,
        2,
        {
          ...proposal,
          expectedCorrectionVersion: 9,
        },
        independent,
      ),
    ).rejects.toThrow(MeipingReviewError);
    const first = await review.reviewCorrection(session.id, storeId, 2, proposal, independent);
    expect(first).toMatchObject({
      sourceRowNumber: 2,
      correctionVersion: 1,
      verdict: 'ACCEPTED',
      correctionAcceptedForLaterReview: true,
      approved: false,
      catalogOrInventoryWritten: false,
    });
    await expect(
      review.reviewCorrection(session.id, storeId, 2, proposal, independent),
    ).rejects.toThrow(MeipingReviewError);
    const page = await review.listRows(session.id, storeId, 0, 10);
    expect(page.items[0]).toMatchObject({
      sourceRowNumber: 2,
      decision: null,
      correction: { version: 1 },
      correctionReview: { verdict: 'ACCEPTED', correctionVersion: 1 },
    });
    await review.saveCorrection(
      session.id,
      storeId,
      2,
      {
        expectedChecksum: checksum,
        expectedVersion: 1,
        proposedFields: { title: '第二版建议' },
        reason: '二次复核',
      },
      author,
    );
    const changed = await review.listRows(session.id, storeId, 0, 10);
    expect(changed.items[0]?.correction).toMatchObject({ version: 2 });
    expect(changed.items[0]?.correctionReview).toBeNull();
    const rejected = await review.reviewCorrection(
      session.id,
      storeId,
      2,
      {
        expectedChecksum: checksum,
        expectedCorrectionVersion: 2,
        verdict: 'REJECTED',
        reason: '缺少充分的复核证据',
      },
      independent,
    );
    expect(rejected).toMatchObject({ correctionVersion: 2, verdict: 'REJECTED' });
    const savedReviews = await database!.db
      .select()
      .from(meipingCorrectionReviews)
      .where(eq(meipingCorrectionReviews.sessionId, session.id));
    expect(savedReviews).toHaveLength(2);
    expect((await database!.db.select().from(books)).length).toBe(beforeBooks.length);
    expect((await database!.db.select().from(storeInventory)).length).toBe(beforeInventory.length);
    const audit = await database!.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, session.id));
    expect(
      audit.filter((item) => item.actionKey === 'meiping.review.correction.verdict'),
    ).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain('PR153-UNIQUE-001');
    expect(JSON.stringify(audit)).not.toContain('核对原书封底');
  });

  it('rejects proposed barcodes already assigned to other Excel rows and wrong-store reviews', async () => {
    const { actorId, storeId, report } = await fixture();
    const author = { actorStaffAccountId: actorId, requestId: randomUUID() };
    const [reviewer] = await database!.db
      .insert(staffAccounts)
      .values({
        loginIdentifier: 'reviewer-' + randomUUID().slice(0, 8),
        passwordHash: 'test-only',
      })
      .returning({ id: staffAccounts.id });
    actorIds.push(reviewer!.id);
    const independent = { actorStaffAccountId: reviewer!.id, requestId: randomUUID() };
    const secondRow = {
      ...report.rows[0]!,
      sourceRowNumber: 3,
      sourceIdentifiers: { ...report.rows[0]!.sourceIdentifiers, barcode: 'EXISTS-555' },
    };
    report.rows.push(secondRow);
    report.totalRows = 2;
    const session = await review.createSession(report, author);
    await review.saveCorrection(
      session.id,
      storeId,
      2,
      {
        expectedChecksum: checksum,
        expectedVersion: 0,
        proposedFields: { barcode: 'EXISTS-555' },
        reason: '建议纸书核对',
      },
      author,
    );
    const proposal = {
      expectedChecksum: checksum,
      expectedCorrectionVersion: 1,
      verdict: 'ACCEPTED' as const,
      reason: '核对结果',
    };
    await expect(
      review.reviewCorrection(session.id, storeId, 2, proposal, independent),
    ).rejects.toThrow(MeipingReviewError);
    await expect(
      review.reviewCorrection(session.id, randomUUID(), 2, proposal, independent),
    ).rejects.toThrow(MeipingReviewError);
    const page = await review.listRows(session.id, storeId, 0, 10);
    expect(page.items[0]?.correctionReview).toBeNull();
  });

  it('versions human correction proposals and never rewrites source rows or catalog stock', async () => {
    const { actorId, storeId, report } = await fixture();
    const audit = { actorStaffAccountId: actorId, requestId: randomUUID() };
    const session = await review.createSession(report, audit);
    const [booksBefore, stockBefore] = await Promise.all([
      database!.db.select().from(books),
      database!.db.select().from(storeInventory),
    ]);
    const first = await review.saveCorrection(
      session.id,
      storeId,
      2,
      {
        expectedChecksum: checksum,
        expectedVersion: 0,
        proposedFields: { author: '建议作者', barcode: 'PR148-NEW-001' },
        reason: '原始数据缺少作者，建议核对纸质图书',
      },
      audit,
    );
    expect(first).toMatchObject({
      sourceRowNumber: 2,
      version: 1,
      status: 'PENDING_VERIFICATION',
      approved: false,
      catalogOrInventoryWritten: false,
    });
    await expect(
      review.saveCorrection(
        session.id,
        storeId,
        2,
        {
          expectedChecksum: checksum,
          expectedVersion: 0,
          proposedFields: { title: '重复写入' },
          reason: '过期版本',
        },
        audit,
      ),
    ).rejects.toThrow(MeipingReviewError);
    const updated = await review.saveCorrection(
      session.id,
      storeId,
      2,
      {
        expectedChecksum: checksum,
        expectedVersion: 1,
        proposedFields: { author: '建议作者乙', priceMinor: 1234 },
        reason: '人工重新核对',
      },
      audit,
    );
    expect(updated.version).toBe(2);
    const page = await review.listRows(session.id, storeId, 0, 20);
    expect(page.items[0]).toMatchObject({
      sourceRowNumber: 2,
      decision: null,
      normalized: { author: null, priceMinor: 3200 },
      correction: {
        version: 2,
        proposedFields: { author: '建议作者乙', priceMinor: 1234 },
      },
    });
    const [stored] = await database!.db
      .select()
      .from(meipingReviewCorrections)
      .where(eq(meipingReviewCorrections.sessionId, session.id));
    expect(stored).toMatchObject({ sourceRowNumber: 2, version: 2 });
    expect((await database!.db.select().from(books)).length).toBe(booksBefore.length);
    expect((await database!.db.select().from(storeInventory)).length).toBe(stockBefore.length);
    const events = await database!.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, session.id));
    expect(events).toHaveLength(3);
    expect(JSON.stringify(events)).not.toContain('建议作者乙');
    expect(JSON.stringify(events)).not.toContain('PR148-NEW-001');
  });

  it('rejects foreign-store corrections, unknown rows and mismatched checksums', async () => {
    const { actorId, storeId, report } = await fixture();
    const audit = { actorStaffAccountId: actorId, requestId: randomUUID() };
    const session = await review.createSession(report, audit);
    const proposal = {
      expectedChecksum: checksum,
      expectedVersion: 0,
      proposedFields: { barcode: 'PR148-NEW-002' },
      reason: '重复条码待核验',
    };
    await expect(
      review.saveCorrection(session.id, randomUUID(), 2, proposal, audit),
    ).rejects.toThrow(MeipingReviewError);
    await expect(review.saveCorrection(session.id, storeId, 999, proposal, audit)).rejects.toThrow(
      MeipingReviewError,
    );
    await expect(
      review.saveCorrection(
        session.id,
        storeId,
        2,
        {
          ...proposal,
          expectedChecksum: 'b'.repeat(64),
        },
        audit,
      ),
    ).rejects.toThrow(MeipingReviewError);
    await expect(
      review.saveCorrection(
        session.id,
        storeId,
        2,
        {
          ...proposal,
          proposedFields: {},
        },
        audit,
      ),
    ).rejects.toThrow(MeipingReviewError);
    const page = await review.listRows(session.id, storeId, 0, 5);
    expect(page.items[0]?.correction).toBeNull();
  });

  it('stages by store/checksum once without modifying catalog or physical stock', async () => {
    const { actorId, storeId, report } = await fixture();
    const audit = { actorStaffAccountId: actorId, requestId: randomUUID() };
    const [booksBefore, inventoryBefore] = await Promise.all([
      database!.db.select().from(books),
      database!.db.select().from(storeInventory),
    ]);
    const created = await review.createSession(report, audit);
    const repeated = await review.createSession(report, audit);
    expect(created).toMatchObject({ created: true, approved: false });
    expect(repeated).toMatchObject({ id: created.id, created: false });
    expect((await database!.db.select().from(books)).length).toBe(booksBefore.length);
    expect((await database!.db.select().from(storeInventory)).length).toBe(inventoryBefore.length);

    const first = await review.listRows(created.id, storeId, 0, 20);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      sourceRowNumber: 2,
      decision: null,
      saleBlocked: false,
    });
    expect(first.catalogOrInventoryWritten).toBe(false);
    const auditEvents = await database!.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, created.id));
    expect(auditEvents).toHaveLength(1);
  });

  it('persists versioned decisions with a separate audit event and blocks stale retries', async () => {
    const { actorId, storeId, report } = await fixture();
    const audit = { actorStaffAccountId: actorId, requestId: randomUUID() };
    const session = await review.createSession(report, audit);
    const initial = {
      sourceRowNumber: 2,
      action: 'CREATE_DRAFT' as const,
      countedQuantity: 3,
      expectedVersion: 0,
      expectedChecksum: checksum,
    };
    const saved = await review.saveDecision(session.id, storeId, 2, initial, audit);
    expect(saved).toMatchObject({ version: 1, approved: false, catalogOrInventoryWritten: false });
    await expect(review.saveDecision(session.id, storeId, 2, initial, audit)).rejects.toThrow(
      MeipingReviewError,
    );
    const updated = await review.saveDecision(
      session.id,
      storeId,
      2,
      {
        sourceRowNumber: 2,
        action: 'EXCLUDE',
        reason: '待确认条码',
        expectedVersion: 1,
        expectedChecksum: checksum,
      },
      audit,
    );
    expect(updated.version).toBe(2);
    const [stored] = await database!.db
      .select()
      .from(meipingReviewDecisions)
      .where(eq(meipingReviewDecisions.sessionId, session.id));
    expect(stored).toMatchObject({ action: 'EXCLUDE', countedQuantity: null, version: 2 });
    expect(
      (await database!.db.select().from(auditLogs).where(eq(auditLogs.resourceId, session.id)))
        .length,
    ).toBe(3);
  });

  it('records complete append-only decision history and rejects concurrent stale writers', async () => {
    const { actorId, storeId, report } = await fixture();
    const session = await review.createSession(report, {
      actorStaffAccountId: actorId,
      requestId: randomUUID(),
    });
    const inputs = [
      { action: 'CREATE_DRAFT' as const, countedQuantity: 3, expectedVersion: 0 },
      { action: 'CREATE_DRAFT' as const, countedQuantity: 5, expectedVersion: 1 },
      { action: 'EXCLUDE' as const, reason: '条码待人工核实', expectedVersion: 2 },
      { action: 'CREATE_DRAFT' as const, countedQuantity: 7, expectedVersion: 3 },
    ];
    const requests: string[] = [];
    for (const input of inputs) {
      const requestId = randomUUID();
      requests.push(requestId);
      const result = await review.saveDecision(
        session.id,
        storeId,
        2,
        { ...input, sourceRowNumber: 2, expectedChecksum: checksum },
        { actorStaffAccountId: actorId, requestId },
      );
      expect(result.version).toBe(requests.length);
    }
    const attempts = await Promise.allSettled(
      [8, 9].map((countedQuantity) =>
        review.saveDecision(
          session.id,
          storeId,
          2,
          {
            action: 'CREATE_DRAFT',
            sourceRowNumber: 2,
            countedQuantity,
            expectedVersion: 4,
            expectedChecksum: checksum,
          },
          { actorStaffAccountId: actorId, requestId: randomUUID() },
        ),
      ),
    );
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: { code: 'CONFLICT' } });

    const events = await database!.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.resourceType, 'MEIPING_REVIEW_SESSION'),
          eq(auditLogs.resourceId, session.id),
          eq(auditLogs.actionKey, 'meiping.review.decision.save'),
        ),
      );
    expect(events).toHaveLength(5);
    // Sort by the version stored in the complete 'next' decision snapshot.
    const revisions = events
      .map((event) => ({ event, metadata: event.metadata }))
      .sort(
        (a, b) =>
          Number((a.metadata.next as { version: number }).version) -
          Number((b.metadata.next as { version: number }).version),
      );
    expect(revisions.map(({ metadata }) => metadata)).toEqual([
      expect.objectContaining({
        previous: null,
        next: { action: 'CREATE_DRAFT', countedQuantity: 3, reason: null, version: 1 },
      }),
      expect.objectContaining({
        previous: { action: 'CREATE_DRAFT', countedQuantity: 3, reason: null, version: 1 },
        next: { action: 'CREATE_DRAFT', countedQuantity: 5, reason: null, version: 2 },
      }),
      expect.objectContaining({
        previous: { action: 'CREATE_DRAFT', countedQuantity: 5, reason: null, version: 2 },
        next: { action: 'EXCLUDE', countedQuantity: null, reason: '条码待人工核实', version: 3 },
      }),
      expect.objectContaining({
        previous: {
          action: 'EXCLUDE',
          countedQuantity: null,
          reason: '条码待人工核实',
          version: 3,
        },
        next: { action: 'CREATE_DRAFT', countedQuantity: 7, reason: null, version: 4 },
      }),
      expect.objectContaining({
        previous: { action: 'CREATE_DRAFT', countedQuantity: 7, reason: null, version: 4 },
      }),
    ]);
    const lastDecision = revisions[4]!.metadata.next as {
      action: string;
      countedQuantity: number;
      reason: string | null;
      version: number;
    };
    expect(lastDecision).toMatchObject({ action: 'CREATE_DRAFT', reason: null, version: 5 });
    expect([8, 9]).toContain(lastDecision.countedQuantity);
    for (const { event, metadata } of revisions) {
      expect(event.actorStaffAccountId).toBe(actorId);
      expect(event.requestId).toBeTruthy();
      expect(event.createdAt).toBeInstanceOf(Date);
      expect(metadata).toMatchObject({
        sessionId: session.id,
        storeId,
        sourceChecksum: checksum,
        sourceRowNumber: 2,
      });
    }
    expect(revisions.slice(0, 4).map(({ event }) => event.requestId)).toEqual(requests);
    const [stored] = await database!.db
      .select()
      .from(meipingReviewDecisions)
      .where(eq(meipingReviewDecisions.sessionId, session.id));
    expect(stored).toMatchObject({ action: 'CREATE_DRAFT', version: 5 });
  });

  it('rejects mismatched store/checksum and review-blocked items', async () => {
    const { actorId, storeId, report } = await fixture();
    const audit = { actorStaffAccountId: actorId, requestId: randomUUID() };
    const session = await review.createSession(report, audit);
    await expect(review.listRows(session.id, randomUUID(), 0, 10)).rejects.toThrow(
      MeipingReviewError,
    );
    await expect(
      review.saveDecision(
        session.id,
        storeId,
        2,
        {
          sourceRowNumber: 2,
          action: 'CREATE_DRAFT',
          countedQuantity: 1,
          expectedVersion: 0,
          expectedChecksum: 'b'.repeat(64),
        },
        audit,
      ),
    ).rejects.toThrow(MeipingReviewError);
    const blocked = { ...report, sourceChecksum: 'c'.repeat(64) };
    blocked.rows = [
      {
        ...report.rows[0]!,
        disposition: 'REVIEW',
        blockingIssues: [
          {
            sourceRowNumber: 2,
            code: 'BARCODE_CONFLICT',
            severity: 'ERROR',
            message: 'Conflict',
          },
        ],
      },
    ];
    const blockedSession = await review.createSession(blocked, audit);
    await expect(
      review.saveDecision(
        blockedSession.id,
        storeId,
        2,
        {
          sourceRowNumber: 2,
          action: 'CREATE_DRAFT',
          countedQuantity: 1,
          expectedVersion: 0,
          expectedChecksum: blocked.sourceChecksum,
        },
        audit,
      ),
    ).rejects.toThrow(MeipingReviewError);
  });
});
