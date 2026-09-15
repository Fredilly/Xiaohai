import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, migrationBatches, migrationBookStaging } from '@xiaohai/db';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const database = hasDatabase ? createDatabase(process.env) : null;
const testSuite = hasDatabase ? describe : describe.skip;

testSuite('M3 migration staging PostgreSQL integration', () => {
  beforeEach(async () => {
    await database!.db.delete(migrationBatches);
  });

  afterAll(async () => database?.pool.end());

  async function createBatch(checksum = 'sha256:test-fixture-a') {
    const [batch] = await database!.db
      .insert(migrationBatches)
      .values({
        sourceType: 'CANONICAL_TEST_FIXTURE',
        sourceReference: 'TEST FIXTURE / CANONICAL SAMPLE — NOT A REAL MEIPING EXPORT',
        checksum,
      })
      .returning({ id: migrationBatches.id });
    return batch!.id;
  }

  it('protects source/checksum idempotency and batch/source-row uniqueness', async () => {
    const batchId = await createBatch();
    await expect(createBatch()).rejects.toBeDefined();
    const rawValues = { title: '测试图书', inventory: '-1', price: 'bad' };
    await database!.db.insert(migrationBookStaging).values({ batchId, sourceRowNumber: 1, rawValues });
    await expect(
      database!.db.insert(migrationBookStaging).values({ batchId, sourceRowNumber: 1, rawValues }),
    ).rejects.toBeDefined();
  });

  it('preserves malformed raw values while constraining normalized inventory and state', async () => {
    const batchId = await createBatch('sha256:test-fixture-b');
    const rawValues = { title: '', inventory: '-9', price: 'oops' };
    const [row] = await database!.db
      .insert(migrationBookStaging)
      .values({
        batchId,
        sourceRowNumber: 1,
        rawValues,
        validationState: 'ERROR',
        issues: [{ code: 'INVENTORY_NEGATIVE' }],
      })
      .returning({ rawValues: migrationBookStaging.rawValues, issues: migrationBookStaging.issues });
    expect(row!.rawValues).toEqual(rawValues);
    expect(row!.issues).toEqual([{ code: 'INVENTORY_NEGATIVE' }]);
    await expect(
      database!.db.insert(migrationBookStaging).values({
        batchId,
        sourceRowNumber: 2,
        rawValues,
        normalizedInventory: -1,
      }),
    ).rejects.toBeDefined();
  });

  it('supports safe partial-failure recovery by reusing the batch without duplicating rows', async () => {
    const batchId = await createBatch('sha256:test-fixture-c');
    await database!.db.insert(migrationBookStaging).values({
      batchId,
      sourceRowNumber: 1,
      rawValues: { title: 'A' },
    });
    await database!.db.insert(migrationBookStaging).values({
      batchId,
      sourceRowNumber: 2,
      rawValues: { title: 'B' },
    });
    await expect(
      database!.db.insert(migrationBookStaging).values({
        batchId,
        sourceRowNumber: 2,
        rawValues: { title: 'B retry' },
      }),
    ).rejects.toBeDefined();
  });
});
