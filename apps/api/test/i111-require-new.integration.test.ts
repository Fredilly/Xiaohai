import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  aiBudgetWindows,
  aiCostReservations,
  aiJobs,
  aiProjects,
  characterProfiles,
  consumerUsers,
  createDatabase,
  mediaAssets,
  pictureBooks,
  workPageIllustrations,
  workPages,
  works,
  workVersions,
} from '@xiaohai/db';
import { createI111SourceBoundFormalApiService } from '../src/picture-book/i111-source-bound-service.js';
import {
  assertI111RequireNewDisposableDatabase,
  type I111RequireNewDatabaseConfig,
} from './i111-require-new-database-guard.js';

const STOP = 'I111_SOURCE_BOUND_API_STOP';
const IDENTITY_STOP = 'I111_REQUIRE_NEW_DATABASE_IDENTITY_STOP';
const ownerId = '11111111-1111-4111-8111-111111111111';
const bookId = '90d7f77e-ae23-40ef-90b6-a672412c6318';
const page1Id = '6fe359ee-71b0-43f5-b49b-08fe2b48a9cb';
const page2Id = 'eae00ed5-6026-4a41-b95a-6c9eea09d076';
const storyProjectId = '10000000-1111-4111-8111-111111111111';
const pictureProjectId = '20000000-1111-4111-8111-111111111111';
const workId = '30000000-1111-4111-8111-111111111111';
const outlineJobId = '40000000-1111-4111-8111-111111111111';
const bodyJobId = '50000000-1111-4111-8111-111111111111';
const outlineVersionId = '60000000-1111-4111-8111-111111111111';
const bodyVersionId = '70000000-1111-4111-8111-111111111111';
const mediaId = '80000000-1111-4111-8111-111111111111';
const characterId = '90000000-1111-4111-8111-111111111111';
const budgetKey = 'I111_MAC_PLAN_B_THREE_PAID_IMAGE_CALLS';

const guardConfig = assertI111RequireNewDisposableDatabase(process.env);
const database = guardConfig ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;
type Db = ReturnType<typeof createDatabase>['db'];

function identityStop(): never {
  throw new Error(IDENTITY_STOP);
}

async function verifyDisposableIdentity(
  config: I111RequireNewDatabaseConfig,
  pool: NonNullable<typeof database>['pool'],
) {
  const identity = await pool.query<{
    databaseComment: string | null;
    databaseName: string;
    databaseOid: number;
    roleName: string;
    serverAddress: string | null;
    serverPort: number | null;
    serverVersion: string;
    systemIdentifier: string;
  }>(`
    select
      current_database() as "databaseName",
      current_user as "roleName",
      inet_server_addr()::text as "serverAddress",
      inet_server_port()::int as "serverPort",
      current_setting('server_version') as "serverVersion",
      database.oid::int as "databaseOid",
      shobj_description(database.oid, 'pg_database') as "databaseComment",
      control.system_identifier::text as "systemIdentifier"
    from pg_database database
    cross join pg_control_system() control
    where database.datname = current_database()
  `);
  const row = identity.rows[0];
  if (
    identity.rows.length !== 1 ||
    !row ||
    row.databaseName !== config.databaseName ||
    row.roleName !== 'xiaohai_i111_require_new_test' ||
    row.databaseComment !== config.databaseComment ||
    row.databaseOid !== config.expectedDatabaseOid ||
    row.serverAddress !== config.expectedServerAddress ||
    row.serverPort !== config.expectedServerPort ||
    row.serverVersion !== config.expectedServerVersion ||
    row.systemIdentifier !== config.expectedSystemIdentifier
  ) {
    identityStop();
  }

  const tables = await pool.query<{ schemaname: string; tablename: string }>(`
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public' and tablename <> '__drizzle_migrations'
    order by tablename
  `);
  const requiredTables = new Set([
    'ai_budget_windows',
    'ai_cost_reservations',
    'ai_jobs',
    'ai_projects',
    'character_profiles',
    'consumer_users',
    'media_assets',
    'picture_books',
    'work_page_illustrations',
    'work_pages',
    'work_versions',
    'works',
  ]);
  const observedTables = new Set(tables.rows.map(({ tablename }) => tablename));
  if ([...requiredTables].some((table) => !observedTables.has(table))) identityStop();

  for (const { schemaname, tablename } of tables.rows) {
    if (!/^[a-z_][a-z0-9_]*$/u.test(tablename) || schemaname !== 'public') identityStop();
    const count = await pool.query<{ count: string }>(
      `select count(*)::text as count from "${tablename}"`,
    );
    if (count.rows.length !== 1 || count.rows[0]?.count !== '0') identityStop();
  }
}

async function seedFixture(db: Db) {
  await db.insert(consumerUsers).values({ id: ownerId });
  await db.insert(aiProjects).values([
    {
      id: storyProjectId,
      projectType: 'STORY',
      title: 'I111 REQUIRE_NEW story fixture',
      createdByConsumerUserId: ownerId,
    },
    {
      id: pictureProjectId,
      projectType: 'PICTURE_BOOK',
      title: 'I111 REQUIRE_NEW picture fixture',
      createdByConsumerUserId: ownerId,
    },
  ]);
  await db.insert(works).values({
    id: workId,
    consumerUserId: ownerId,
    aiProjectId: storyProjectId,
    workType: 'STORY',
    title: 'I111 REQUIRE_NEW story fixture',
    idea: 'fixture only',
    ageRange: '6-8',
    theme: 'fixture',
    style: 'fixture',
  });
  await db.insert(aiJobs).values([
    {
      id: outlineJobId,
      projectId: storyProjectId,
      jobType: 'STORY_OUTLINE',
      provider: 'MOCK',
      model: 'offline-fixture',
      status: 'SUCCEEDED',
      input: { prompt: 'fixture outline' },
      maxAttempts: 1,
      timeoutMs: 5_000,
    },
    {
      id: bodyJobId,
      projectId: storyProjectId,
      jobType: 'STORY_BODY',
      provider: 'MOCK',
      model: 'offline-fixture',
      status: 'SUCCEEDED',
      input: { prompt: 'fixture body' },
      maxAttempts: 1,
      timeoutMs: 5_000,
    },
  ]);
  await db.insert(workVersions).values([
    {
      id: outlineVersionId,
      workId,
      versionNumber: 1,
      contentKind: 'OUTLINE',
      operation: 'OUTLINE',
      sourceAiJobId: outlineJobId,
      content: 'fixture outline',
    },
    {
      id: bodyVersionId,
      workId,
      versionNumber: 2,
      contentKind: 'BODY',
      operation: 'BODY',
      sourceVersionId: outlineVersionId,
      sourceAiJobId: bodyJobId,
      content: 'fixture body',
    },
  ]);
  await db.insert(pictureBooks).values({
    id: bookId,
    consumerUserId: ownerId,
    aiProjectId: pictureProjectId,
    storyWorkId: workId,
    sourceStoryVersionId: bodyVersionId,
    title: 'I111 REQUIRE_NEW picture fixture',
    status: 'PLANNED',
  });
  await db.insert(mediaAssets).values({
    id: mediaId,
    provider: 'BAIDU_BOS',
    objectKey: 'i111-require-new-test/reference.png',
    playbackUrl: 'https://offline.invalid/i111-require-new-test/reference.png',
    mimeType: 'image/png',
    byteSize: 1,
    status: 'READY',
  });
  await db.insert(characterProfiles).values({
    id: characterId,
    pictureBookId: bookId,
    name: 'Offline fixture character',
    description: 'offline fixture',
    visualPrompt: 'offline fixture character',
    confirmed: true,
    locked: true,
    consistencyKey: characterId,
    referenceMediaAssetId: mediaId,
  });
  await db.insert(workPages).values([
    {
      id: page1Id,
      pictureBookId: bookId,
      pageNumber: 1,
      pageKind: 'CONTENT',
      storyText: 'fixture page one',
      sceneDescription: 'fixture page one',
      illustrationPrompt: 'fixture page one illustration',
      characterIds: [characterId],
    },
    {
      id: page2Id,
      pictureBookId: bookId,
      pageNumber: 2,
      pageKind: 'CONTENT',
      storyText: 'fixture page two',
      sceneDescription: 'fixture page two',
      illustrationPrompt: 'fixture page two illustration',
      characterIds: [characterId],
    },
  ]);
}

function input(pageId: string, regenerate: boolean) {
  return { consumerUserId: ownerId, pictureBookId: bookId, pageId, regenerate };
}

function transactionOutcomeDb(db: Db, outcome: 'ROLLBACK' | 'UNKNOWN_COMMIT') {
  let attempts = 0;
  const wrapped = {
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      attempts += 1;
      if (outcome === 'ROLLBACK') {
        return db.transaction(async (tx) => {
          await callback(tx);
          throw new Error('I111_TEST_INJECTED_ROLLBACK');
        });
      }
      await db.transaction((tx) => callback(tx));
      throw new Error('I111_TEST_UNKNOWN_COMMIT_RESULT');
    },
  } as unknown as Db;
  return { db: wrapped, attempts: () => attempts };
}

suite('I111 REQUIRE_NEW real PostgreSQL transaction behavior', () => {
  const { db, pool } = database!;

  beforeAll(async () => verifyDisposableIdentity(guardConfig!, pool));
  afterAll(async () => pool.end());

  it('serializes creation, rejects active reuse, rolls back atomically and preserves unknown commits', async () => {
    await seedFixture(db);

    const concurrent = await Promise.allSettled([
      createI111SourceBoundFormalApiService(db).prepareViaFormalApi(input(page1Id, false)),
      createI111SourceBoundFormalApiService(db).prepareViaFormalApi(input(page1Id, false)),
    ]);
    expect(concurrent.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = concurrent.filter(({ status }) => status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: { message: STOP } });

    const page1Illustrations = await db
      .select()
      .from(workPageIllustrations)
      .where(eq(workPageIllustrations.pageId, page1Id));
    expect(page1Illustrations).toHaveLength(1);
    const page1Reservations = await db
      .select()
      .from(aiCostReservations)
      .where(eq(aiCostReservations.resourceId, page1Illustrations[0]!.id));
    expect(page1Reservations).toHaveLength(1);
    expect(
      await db.select().from(aiCostReservations).where(eq(aiCostReservations.budgetKey, budgetKey)),
    ).toHaveLength(1);

    const [active] = await db
      .insert(workPageIllustrations)
      .values({
        pageId: page2Id,
        revisionNumber: 1,
        prompt: 'existing active fixture',
        provider: 'BAILIAN',
        model: 'qwen-image-3.0',
        consistency: [
          {
            consistencyKey: characterId,
            visualPrompt: 'offline fixture character',
            referenceMediaAssetId: mediaId,
          },
        ],
        status: 'QUEUED',
      })
      .returning();
    const reservationCountBeforeActive = (
      await db.select().from(aiCostReservations).where(eq(aiCostReservations.budgetKey, budgetKey))
    ).length;
    const queuedBefore = (
      await db.select().from(workPageIllustrations).where(eq(workPageIllustrations.id, active!.id))
    )[0];
    await expect(
      createI111SourceBoundFormalApiService(db).prepareViaFormalApi(input(page2Id, false)),
    ).rejects.toThrow(STOP);
    expect(
      (
        await db
          .select()
          .from(workPageIllustrations)
          .where(eq(workPageIllustrations.id, active!.id))
      )[0],
    ).toEqual(queuedBefore);

    await db
      .update(workPageIllustrations)
      .set({ status: 'RUNNING', updatedAt: new Date() })
      .where(eq(workPageIllustrations.id, active!.id));
    const runningBefore = (
      await db.select().from(workPageIllustrations).where(eq(workPageIllustrations.id, active!.id))
    )[0];
    await expect(
      createI111SourceBoundFormalApiService(db).prepareViaFormalApi(input(page2Id, false)),
    ).rejects.toThrow(STOP);
    expect(
      (
        await db
          .select()
          .from(workPageIllustrations)
          .where(eq(workPageIllustrations.id, active!.id))
      )[0],
    ).toEqual(runningBefore);
    expect(
      await db.select().from(aiCostReservations).where(eq(aiCostReservations.budgetKey, budgetKey)),
    ).toHaveLength(reservationCountBeforeActive);

    await db
      .update(workPageIllustrations)
      .set({ status: 'FAILED', errorCode: 'I111_TEST_ACTIVE_RELEASED', updatedAt: new Date() })
      .where(eq(workPageIllustrations.id, active!.id));
    const reservationsBeforeRollback = await db
      .select()
      .from(aiCostReservations)
      .where(eq(aiCostReservations.budgetKey, budgetKey))
      .orderBy(asc(aiCostReservations.id));
    const windowsBeforeRollback = await db
      .select()
      .from(aiBudgetWindows)
      .where(eq(aiBudgetWindows.budgetKey, budgetKey))
      .orderBy(asc(aiBudgetWindows.scopeType));
    const bookBeforeRollback = (
      await db.select().from(pictureBooks).where(eq(pictureBooks.id, bookId))
    )[0];
    const rollback = transactionOutcomeDb(db, 'ROLLBACK');
    await expect(
      createI111SourceBoundFormalApiService(rollback.db).prepareViaFormalApi(input(page2Id, true)),
    ).rejects.toThrow(STOP);
    expect(rollback.attempts()).toBe(1);
    expect(
      await db
        .select()
        .from(workPageIllustrations)
        .where(eq(workPageIllustrations.pageId, page2Id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(aiCostReservations)
        .where(eq(aiCostReservations.budgetKey, budgetKey))
        .orderBy(asc(aiCostReservations.id)),
    ).toEqual(reservationsBeforeRollback);
    expect(
      await db
        .select()
        .from(aiBudgetWindows)
        .where(eq(aiBudgetWindows.budgetKey, budgetKey))
        .orderBy(asc(aiBudgetWindows.scopeType)),
    ).toEqual(windowsBeforeRollback);
    expect((await db.select().from(pictureBooks).where(eq(pictureBooks.id, bookId)))[0]).toEqual(
      bookBeforeRollback,
    );

    const unknown = transactionOutcomeDb(db, 'UNKNOWN_COMMIT');
    const prepareUnknown = createI111SourceBoundFormalApiService(unknown.db);
    await expect(prepareUnknown.prepareViaFormalApi(input(page2Id, true))).rejects.toThrow(STOP);
    const illustrationsAfterUnknown = await db
      .select()
      .from(workPageIllustrations)
      .where(eq(workPageIllustrations.pageId, page2Id))
      .orderBy(asc(workPageIllustrations.revisionNumber));
    const reservationsAfterUnknown = await db
      .select()
      .from(aiCostReservations)
      .where(eq(aiCostReservations.budgetKey, budgetKey))
      .orderBy(asc(aiCostReservations.id));
    const windowsAfterUnknown = await db
      .select()
      .from(aiBudgetWindows)
      .where(eq(aiBudgetWindows.budgetKey, budgetKey))
      .orderBy(asc(aiBudgetWindows.scopeType));
    expect(illustrationsAfterUnknown).toHaveLength(2);
    expect(illustrationsAfterUnknown[1]).toMatchObject({ revisionNumber: 2, status: 'QUEUED' });
    expect(reservationsAfterUnknown).toHaveLength(reservationsBeforeRollback.length + 1);
    expect(
      reservationsAfterUnknown.filter(
        ({ resourceId }) => resourceId === illustrationsAfterUnknown[1]!.id,
      ),
    ).toHaveLength(1);
    expect(windowsAfterUnknown).toHaveLength(windowsBeforeRollback.length);
    expect(windowsAfterUnknown.map((window) => window.reservedMinor)).toEqual(
      windowsBeforeRollback.map((window) => window.reservedMinor + 25),
    );

    await expect(prepareUnknown.prepareViaFormalApi(input(page2Id, true))).rejects.toThrow(STOP);
    expect(unknown.attempts()).toBe(1);
    expect(
      await db
        .select()
        .from(workPageIllustrations)
        .where(eq(workPageIllustrations.pageId, page2Id))
        .orderBy(asc(workPageIllustrations.revisionNumber)),
    ).toEqual(illustrationsAfterUnknown);
    expect(
      await db
        .select()
        .from(aiCostReservations)
        .where(eq(aiCostReservations.budgetKey, budgetKey))
        .orderBy(asc(aiCostReservations.id)),
    ).toEqual(reservationsAfterUnknown);
  });
});
