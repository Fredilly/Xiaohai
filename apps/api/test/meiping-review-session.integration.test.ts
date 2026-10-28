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
  meipingReviewCorrectionHistory,
  meipingReviewDecisionHistory,
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
            .delete(meipingReviewCorrectionHistory)
            .where(inArray(meipingReviewCorrectionHistory.sessionId, sessionIds));
          await database.db
            .delete(meipingReviewCorrections)
            .where(inArray(meipingReviewCorrections.sessionId, sessionIds));
          await database.db
            .delete(meipingReviewDecisionHistory)
            .where(inArray(meipingReviewDecisionHistory.sessionId, sessionIds));
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
    const verdictAudit = audit.filter(
      (item) => item.actionKey === 'meiping.review.correction.verdict',
    );
    expect(verdictAudit).toHaveLength(2);
    // #152 intentionally stores complete proposal revisions in restricted
    // audit_logs. Only the independent-verdict event must omit raw proposal
    // values and the reviewer's free-text reason.
    const correctionAudit = audit.filter(
      (item) => item.actionKey === 'meiping.review.correction.save',
    );
    expect(correctionAudit).toHaveLength(2);
    expect(JSON.stringify(correctionAudit)).toContain('PR153-UNIQUE-001');
    expect(JSON.stringify(verdictAudit)).not.toContain('PR153-UNIQUE-001');
    expect(JSON.stringify(verdictAudit)).not.toContain('核对原书封底');
  });

  it('serializes concurrent acceptance of the same barcode across different source rows', async () => {
    const { actorId, storeId, report } = await fixture();
    const author = { actorStaffAccountId: actorId, requestId: randomUUID() };
    const originalRow = report.rows[0]!;
    report.rows.push({
      ...originalRow,
      sourceRowNumber: 3,
      sourceIdentifiers: {
        ...originalRow.sourceIdentifiers,
        bookCode: 'B-TEST-SECOND',
        barcode: '69000005678',
      },
    });
    report.totalRows = 2;
    report.createCandidateRows = 2;
    report.metadataWarningRows = 2;
    report.assumedInventoryRows = 2;
    report.plannedInventoryTotal = 2;

    const reviewers = await database!.db
      .insert(staffAccounts)
      .values([
        { loginIdentifier: 'reviewer-' + randomUUID(), passwordHash: 'test-only' },
        { loginIdentifier: 'reviewer-' + randomUUID(), passwordHash: 'test-only' },
      ])
      .returning({ id: staffAccounts.id });
    actorIds.push(...reviewers.map((item) => item.id));
    const firstReviewer = {
      actorStaffAccountId: reviewers[0]!.id,
      requestId: randomUUID(),
    };
    const secondReviewer = {
      actorStaffAccountId: reviewers[1]!.id,
      requestId: randomUUID(),
    };
    const session = await review.createSession(report, author);
    const [booksBefore, stockBefore] = await Promise.all([
      database!.db.select().from(books),
      database!.db.select().from(storeInventory),
    ]);

    for (const sourceRowNumber of [2, 3]) {
      await review.saveCorrection(
        session.id,
        storeId,
        sourceRowNumber,
        {
          expectedChecksum: checksum,
          expectedVersion: 0,
          proposedFields: { barcode: 'PR153-SHARED-001' },
          reason: 'synthetic concurrent barcode proposal',
        },
        author,
      );
    }

    const reviewInput = {
      expectedChecksum: checksum,
      expectedCorrectionVersion: 1,
      verdict: 'ACCEPTED' as const,
      reason: 'independent check of synthetic proposal',
    };
    // Distinct reviewers and distinct rows: the correction-row locks alone
    // would allow both to see no accepted barcode and both to insert.
    const attempts = await Promise.allSettled([
      review.reviewCorrection(session.id, storeId, 2, reviewInput, firstReviewer),
      review.reviewCorrection(session.id, storeId, 3, reviewInput, secondReviewer),
    ]);
    const accepted = attempts.filter((item) => item.status === 'fulfilled');
    const rejected = attempts.filter((item) => item.status === 'rejected');
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rejection: unknown = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejection).toBeInstanceOf(MeipingReviewError);
    if (!(rejection instanceof MeipingReviewError)) {
      throw new Error('Expected barcode conflict');
    }
    expect(rejection.code).toBe('BARCODE_NOT_VERIFIED');

    const verdicts = await database!.db
      .select()
      .from(meipingCorrectionReviews)
      .where(eq(meipingCorrectionReviews.sessionId, session.id));
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.verdict).toBe('ACCEPTED');
    expect(verdicts[0]?.correctionVersion).toBe(1);
    expect([2, 3]).toContain(verdicts[0]?.sourceRowNumber);
    const reviewerIds = [firstReviewer.actorStaffAccountId, secondReviewer.actorStaffAccountId];
    expect(reviewerIds).toContain(verdicts[0]?.reviewedByStaffAccountId);

    const events = await database!.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, session.id));
    const verdictEvents = events.filter(
      (event) => event.actionKey === 'meiping.review.correction.verdict',
    );
    expect(verdictEvents).toHaveLength(1);
    expect(verdictEvents[0]?.metadata).toMatchObject({
      sourceRowNumber: verdicts[0]?.sourceRowNumber,
      correctionVersion: 1,
      verdict: 'ACCEPTED',
    });
    expect(JSON.stringify(verdictEvents)).not.toContain('PR153-SHARED-001');
    const proposalEvents = events.filter(
      (event) => event.actionKey === 'meiping.review.correction.save',
    );
    expect(proposalEvents).toHaveLength(2);
    expect((await review.listRows(session.id, storeId, 0, 10)).status).toBe('DRAFT');
    expect((await database!.db.select().from(books)).length).toBe(booksBefore.length);
    expect((await database!.db.select().from(storeInventory)).length).toBe(stockBefore.length);
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

  it('reconstructs CREATE→EDIT correction history without changing source or formal stock', async () => {
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
        proposedFields: { barcode: 'PR148-NEW-001', priceMinor: 1200 },
        reason: 'first proposal: verify barcode and price',
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
          proposedFields: { title: 'stale proposal' },
          reason: 'stale',
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
        proposedFields: { barcode: 'PR148-NEW-002', priceMinor: 1234 },
        reason: 'revised proposal: rechecked physical book',
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
        proposedFields: { barcode: 'PR148-NEW-002', priceMinor: 1234 },
      },
    });
    const [stored] = await database!.db
      .select()
      .from(meipingReviewCorrections)
      .where(eq(meipingReviewCorrections.sessionId, session.id));
    expect(stored).toMatchObject({ sourceRowNumber: 2, version: 2 });

    // Only restricted audit storage contains the complete sensitive history;
    // ordinary Staff review responses continue to expose just the latest draft.
    const events = await database!.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, session.id));
    expect(events).toHaveLength(3); // session creation + exactly two successful saves
    const revisions = events.filter(
      (event) => event.actionKey === 'meiping.review.correction.save',
    );
    const firstRevision = revisions.find((event) => event.metadata.expectedVersion === 0);
    const secondRevision = revisions.find((event) => event.metadata.expectedVersion === 1);
    expect(revisions).toHaveLength(2);
    for (const event of revisions) {
      expect(event).toMatchObject({
        actorStaffAccountId: actorId,
        resourceType: 'MEIPING_REVIEW_SESSION',
        resourceId: session.id,
        requestId: audit.requestId,
      });
      expect(event.createdAt).toBeInstanceOf(Date);
      expect(event.metadata).toMatchObject({
        sessionId: session.id,
        storeId,
        sourceChecksum: checksum,
        sourceRowNumber: 2,
      });
    }
    expect(firstRevision?.metadata).toMatchObject({
      expectedVersion: 0,
      previous: null,
      next: {
        version: 1,
        proposedFields: { barcode: 'PR148-NEW-001', priceMinor: 1200 },
        reason: 'first proposal: verify barcode and price',
      },
    });
    expect(secondRevision?.metadata).toMatchObject({
      expectedVersion: 1,
      previous: {
        version: 1,
        proposedFields: { barcode: 'PR148-NEW-001', priceMinor: 1200 },
        reason: 'first proposal: verify barcode and price',
      },
      next: {
        version: 2,
        proposedFields: { barcode: 'PR148-NEW-002', priceMinor: 1234 },
        reason: 'revised proposal: rechecked physical book',
      },
    });
    expect((await database!.db.select().from(books)).length).toBe(booksBefore.length);
    expect((await database!.db.select().from(storeInventory)).length).toBe(stockBefore.length);
  });

  it('rejects concurrent stale correction writers without producing phantom audit revisions', async () => {
    const { actorId, storeId, report } = await fixture();
    const audit = { actorStaffAccountId: actorId, requestId: randomUUID() };
    const session = await review.createSession(report, audit);
    await review.saveCorrection(
      session.id,
      storeId,
      2,
      {
        expectedChecksum: checksum,
        expectedVersion: 0,
        proposedFields: { priceMinor: 1000 },
        reason: 'initial',
      },
      audit,
    );
    const proposalA = {
      expectedChecksum: checksum,
      expectedVersion: 1,
      proposedFields: { priceMinor: 1500 },
      reason: 'concurrent A',
    };
    const proposalB = {
      expectedChecksum: checksum,
      expectedVersion: 1,
      proposedFields: { priceMinor: 1700 },
      reason: 'concurrent B',
    };
    const changes = await Promise.allSettled([
      review.saveCorrection(session.id, storeId, 2, proposalA, audit),
      review.saveCorrection(session.id, storeId, 2, proposalB, audit),
    ]);
    expect(changes.filter((change) => change.status === 'fulfilled')).toHaveLength(1);
    expect(changes.filter((change) => change.status === 'rejected')).toHaveLength(1);
    const [current] = await database!.db
      .select()
      .from(meipingReviewCorrections)
      .where(eq(meipingReviewCorrections.sessionId, session.id));
    expect(current?.version).toBe(2);
    const allEvents = await database!.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, session.id));
    const revisions = allEvents
      .filter((event) => event.actionKey === 'meiping.review.correction.save')
      .map((event) => event.metadata);
    expect(revisions).toHaveLength(2);
    expect(revisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ expectedVersion: 0, previous: null }),
        expect.objectContaining({ expectedVersion: 1 }),
      ]),
    );
    const version2 = revisions.find((event) => (event.next as { version: number }).version === 2);
    expect(version2?.previous).toMatchObject({
      version: 1,
      proposedFields: { priceMinor: 1000 },
      reason: 'initial',
    });
    expect(version2?.next).toMatchObject({
      version: 2,
      proposedFields: { priceMinor: current?.proposedFields.priceMinor },
      reason: current?.reason,
    });
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
    const decisionHistory = await database!.db
      .select()
      .from(meipingReviewDecisionHistory)
      .where(eq(meipingReviewDecisionHistory.sessionId, session.id));
    expect(decisionHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ version: 1, action: 'CREATE_DRAFT', countedQuantity: 3 }),
        expect.objectContaining({ version: 2, action: 'EXCLUDE', reason: '待确认条码' }),
      ]),
    );
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


  it('rolls back current decision and audit when a history version key already exists', async () => {
    const { actorId, storeId, report } = await fixture();
    const audit = { actorStaffAccountId: actorId, requestId: randomUUID() };
    const session = await review.createSession(report, audit);
    await review.saveDecision(
      session.id, storeId, 2,
      { sourceRowNumber: 2, action: 'CREATE_DRAFT', countedQuantity: 2, expectedVersion: 0, expectedChecksum: checksum },
      audit,
    );
    // Deliberate collision with the NEXT version, while the mutable row is
    // still at version 1. No current-row or audit write may survive failure.
    await database!.db.insert(meipingReviewDecisionHistory).values({
      sessionId: session.id, sourceRowNumber: 2, version: 2, action: 'EXCLUDE',
      countedQuantity: null, reason: 'conflicting immutable snapshot',
      updatedByStaffAccountId: actorId, updatedAt: new Date(),
    });
    const beforeAudit = await database!.db.select({ id: auditLogs.id }).from(auditLogs)
      .where(eq(auditLogs.resourceId, session.id));
    await expect(
      review.saveDecision(
        session.id, storeId, 2,
        { sourceRowNumber: 2, action: 'EXCLUDE', reason: 'attempted overwrite', expectedVersion: 1, expectedChecksum: checksum },
        audit,
      ),
    ).rejects.toThrow();
    const [current] = await database!.db.select().from(meipingReviewDecisions)
      .where(eq(meipingReviewDecisions.sessionId, session.id));
    const history = await database!.db.select().from(meipingReviewDecisionHistory)
      .where(eq(meipingReviewDecisionHistory.sessionId, session.id));
    const afterAudit = await database!.db.select({ id: auditLogs.id }).from(auditLogs)
      .where(eq(auditLogs.resourceId, session.id));
    expect(current).toMatchObject({ version: 1, action: 'CREATE_DRAFT', countedQuantity: 2 });
    expect(history).toHaveLength(2);
    expect(history.find((entry) => entry.version === 2)?.reason).toBe('conflicting immutable snapshot');
    expect(afterAudit).toEqual(beforeAudit);
  });

  it('rolls back current correction and audit when a history version key already exists', async () => {
    const { actorId, storeId, report } = await fixture();
    const audit = { actorStaffAccountId: actorId, requestId: randomUUID() };
    const session = await review.createSession(report, audit);
    await review.saveCorrection(
      session.id, storeId, 2,
      { expectedChecksum: checksum, expectedVersion: 0, proposedFields: { priceMinor: 100 }, reason: 'initial' },
      audit,
    );
    await database!.db.insert(meipingReviewCorrectionHistory).values({
      sessionId: session.id, sourceRowNumber: 2, version: 2,
      proposedFields: { priceMinor: 999 }, reason: 'conflicting immutable snapshot',
      updatedByStaffAccountId: actorId, updatedAt: new Date(),
    });
    const beforeAudit = await database!.db.select({ id: auditLogs.id }).from(auditLogs)
      .where(eq(auditLogs.resourceId, session.id));
    await expect(
      review.saveCorrection(
        session.id, storeId, 2,
        { expectedChecksum: checksum, expectedVersion: 1, proposedFields: { priceMinor: 150 }, reason: 'attempted overwrite' },
        audit,
      ),
    ).rejects.toThrow();
    const [current] = await database!.db.select().from(meipingReviewCorrections)
      .where(eq(meipingReviewCorrections.sessionId, session.id));
    const history = await database!.db.select().from(meipingReviewCorrectionHistory)
      .where(eq(meipingReviewCorrectionHistory.sessionId, session.id));
    const afterAudit = await database!.db.select({ id: auditLogs.id }).from(auditLogs)
      .where(eq(auditLogs.resourceId, session.id));
    expect(current).toMatchObject({ version: 1, proposedFields: { priceMinor: 100 }, reason: 'initial' });
    expect(history).toHaveLength(2);
    expect(history.find((entry) => entry.version === 2)?.reason).toBe('conflicting immutable snapshot');
    expect(afterAudit).toEqual(beforeAudit);
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
