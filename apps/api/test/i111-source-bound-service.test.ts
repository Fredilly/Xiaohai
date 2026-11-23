import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiBudgetWindows, aiCostReservations, workPageIllustrations } from '@xiaohai/db';
import { createI111SourceBoundFormalApiService } from '../src/picture-book/i111-source-bound-service.js';
import { PictureBookService } from '../src/picture-book/picture-book-service.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const bookId = '90d7f77e-ae23-40ef-90b6-a672412c6318';
const page1Id = '6fe359ee-71b0-43f5-b49b-08fe2b48a9cb';
const page2Id = 'eae00ed5-6026-4a41-b95a-6c9eea09d076';
const illustrationId = '00000000-1111-4222-8333-444444444444';
const characterId = '00000000-1111-4222-8333-555555555555';
const referenceId = '00000000-1111-4222-8333-666666666666';
const db = { transaction: () => Promise.resolve(null) } as never;

const input = (pageId = page1Id, regenerate = false) => ({
  consumerUserId: ownerId,
  pictureBookId: bookId,
  pageId,
  regenerate,
});

function query(result: unknown, onValues?: (value: unknown) => unknown) {
  let resolved = result;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of [
    'from',
    'innerJoin',
    'where',
    'orderBy',
    'limit',
    'for',
    'onConflictDoNothing',
    'returning',
    'set',
  ]) {
    builder[method] = chain;
  }
  builder.values = (value: unknown) => {
    resolved = onValues ? onValues(value) : resolved;
    return builder;
  };
  builder.then = (
    fulfilled: (value: unknown) => unknown,
    rejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(resolved).then(fulfilled, rejected);
  return builder;
}

function ownedPage() {
  return {
    page: { illustrationPrompt: 'fixed I111 prompt', characterIds: [characterId] },
    book: {},
  };
}

function lockedCharacter() {
  return {
    id: characterId,
    confirmed: true,
    locked: true,
    referenceMediaAssetId: referenceId,
    consistencyKey: characterId,
    visualPrompt: 'fixed I111 character',
  };
}

function activeIllustrationDb(status: 'QUEUED' | 'RUNNING') {
  let selectIndex = 0;
  let transactionCalls = 0;
  const selections = [
    [ownedPage()],
    [lockedCharacter()],
    [{ id: illustrationId, status, revisionNumber: 1 }],
  ];
  const transaction = async (callback: (tx: unknown) => Promise<unknown>) => {
    transactionCalls += 1;
    const tx = { select: () => query(selections[selectIndex++] ?? []) };
    return callback(tx);
  };
  return {
    db: { transaction } as never,
    transactionCalls: () => transactionCalls,
  };
}

function newIllustrationDb(unknownCommit = false) {
  let selectIndex = 0;
  let transactionCalls = 0;
  let insideTransaction = false;
  const inserts: Array<{ table: unknown; value: unknown; insideTransaction: boolean }> = [];
  const windows = [
    {
      id: '00000000-1111-4222-8333-777777777777',
      scopeType: 'GLOBAL',
      consumerUserId: null,
      reservedMinor: 0,
      actualMinor: 0,
      limitMinor: 200,
    },
    {
      id: '00000000-1111-4222-8333-888888888888',
      scopeType: 'CONSUMER',
      consumerUserId: ownerId,
      reservedMinor: 0,
      actualMinor: 0,
      limitMinor: 200,
    },
  ];
  const selections = [
    [ownedPage()],
    [lockedCharacter()],
    [],
    [],
    [{ value: 1 }],
    [],
    [windows[0]],
    [windows[1]],
  ];
  const tx = {
    select: () => query(selections[selectIndex++] ?? []),
    insert: (table: unknown) =>
      query([], (value) => {
        inserts.push({ table, value, insideTransaction });
        if (table === workPageIllustrations) {
          return [{ ...(value as object), id: illustrationId, status: 'QUEUED' }];
        }
        if (table === aiCostReservations) {
          return [
            {
              ...(value as object),
              id: '00000000-1111-4222-8333-999999999999',
              status: 'RESERVED',
              uncertainty: 'NONE',
            },
          ];
        }
        return [];
      }),
    update: () => query([]),
  };
  const transaction = async (callback: (transaction: unknown) => Promise<unknown>) => {
    transactionCalls += 1;
    insideTransaction = true;
    try {
      const result = await callback(tx);
      if (unknownCommit) throw new Error('commit result unknown');
      return result;
    } finally {
      insideTransaction = false;
    }
  };
  return {
    db: { transaction } as never,
    inserts,
    transactionCalls: () => transactionCalls,
  };
}

describe('I111 real PictureBookService with no Redis broadcast', () => {
  beforeEach(() => vi.stubEnv('APP_ENV', 'dev'));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    [page1Id, 1, false],
    [page2Id, 1, false],
    [page2Id, 2, true],
  ])(
    'binds the real method to the fixed page/revision %#',
    async (pageId, revision, regenerate) => {
      const invoked = vi
        .spyOn(PictureBookService.prototype, 'generateIllustration')
        .mockImplementation(async function (
          this: PictureBookService,
          user,
          book,
          page,
          next,
          policy,
        ) {
          expect([user, book, page, next, policy]).toEqual([
            ownerId,
            bookId,
            pageId,
            regenerate,
            'REQUIRE_NEW',
          ]);
          const queue = this as unknown as {
            imageQueue: { notify: (id: string) => Promise<void> };
            config: {
              imageEnabled: boolean;
              imageModel: string;
              imageBudget: { amountMinor: number };
            };
          };
          expect(queue.config).toMatchObject({
            imageEnabled: true,
            imageModel: 'qwen-image-3.0',
            imageBudget: { amountMinor: 25 },
          });
          await queue.imageQueue.notify(illustrationId);
          return {
            pictureBookId: bookId,
            pageId: page,
            revisionNumber: revision,
            illustrationId,
            status: 'QUEUED' as const,
          };
        });
      const prepare = createI111SourceBoundFormalApiService(db);
      expect(await prepare.prepareViaFormalApi(input(pageId, regenerate))).toMatchObject({
        illustrationId,
        revisionNumber: revision,
      });
      await expect(prepare.prepareViaFormalApi(input(pageId, regenerate))).rejects.toThrow(
        'I111_SOURCE_BOUND_API_STOP',
      );
      expect(invoked).toHaveBeenCalledOnce();
    },
  );

  it.each(['QUEUED', 'RUNNING'] as const)(
    'stops on an existing %s illustration through the real service path',
    async (status) => {
      const existing = activeIllustrationDb(status);
      const prepare = createI111SourceBoundFormalApiService(existing.db);
      await expect(prepare.prepareViaFormalApi(input())).rejects.toThrow(
        'I111_SOURCE_BOUND_API_STOP',
      );
      await expect(prepare.prepareViaFormalApi(input())).rejects.toThrow(
        'I111_SOURCE_BOUND_API_STOP',
      );
      expect(existing.transactionCalls()).toBe(1);
    },
  );

  it('creates the illustration and reservation in the same transaction on the real path', async () => {
    const created = newIllustrationDb();
    const prepare = createI111SourceBoundFormalApiService(created.db);

    await expect(prepare.prepareViaFormalApi(input())).resolves.toMatchObject({
      illustrationId,
      revisionNumber: 1,
    });

    const illustrationInsert = created.inserts.find(({ table }) => table === workPageIllustrations);
    const reservationInsert = created.inserts.find(({ table }) => table === aiCostReservations);
    expect(illustrationInsert).toMatchObject({ insideTransaction: true });
    expect(reservationInsert).toMatchObject({
      insideTransaction: true,
      value: {
        resourceId: illustrationId,
        idempotencyKey: `picture-book-image:${illustrationId}`,
      },
    });
    expect(created.inserts.filter(({ table }) => table === aiBudgetWindows)).toHaveLength(2);
    expect(created.transactionCalls()).toBe(1);
  });

  it('rejects invalid owner, book, page, regeneration and production before DB use', async () => {
    const invoked = vi.spyOn(PictureBookService.prototype, 'generateIllustration');
    for (const invalid of [
      { consumerUserId: 'wrong' },
      { pictureBookId: 'wrong' },
      { pageId: 'wrong' },
      { pageId: page1Id, regenerate: true },
      { regenerate: 'false' },
      { extra: 'unexpected' },
    ]) {
      const prepare = createI111SourceBoundFormalApiService(db);
      await expect(
        prepare.prepareViaFormalApi({ ...input(), ...invalid } as never),
      ).rejects.toThrow('I111_SOURCE_BOUND_API_STOP');
    }
    expect(invoked).not.toHaveBeenCalled();
    vi.stubEnv('APP_ENV', 'production');
    expect(() => createI111SourceBoundFormalApiService(db)).toThrow('I111_SOURCE_BOUND_API_STOP');
  });

  it('does not retry the real path after an unknown transaction commit result', async () => {
    const uncertain = newIllustrationDb(true);
    const prepare = createI111SourceBoundFormalApiService(uncertain.db);
    await expect(prepare.prepareViaFormalApi(input())).rejects.toThrow(
      'I111_SOURCE_BOUND_API_STOP',
    );
    await expect(prepare.prepareViaFormalApi(input())).rejects.toThrow(
      'I111_SOURCE_BOUND_API_STOP',
    );
    expect(uncertain.transactionCalls()).toBe(1);
    expect(uncertain.inserts.some(({ table }) => table === workPageIllustrations)).toBe(true);
    expect(uncertain.inserts.some(({ table }) => table === aiCostReservations)).toBe(true);
  });

  it('stops when the formal API result has no matching queue notification', async () => {
    vi.spyOn(PictureBookService.prototype, 'generateIllustration').mockResolvedValue({
      pictureBookId: bookId,
      pageId: page1Id,
      revisionNumber: 1,
      illustrationId,
      status: 'QUEUED',
    });
    const noNotification = createI111SourceBoundFormalApiService(db);
    await expect(noNotification.prepareViaFormalApi(input())).rejects.toThrow(
      'I111_SOURCE_BOUND_API_STOP',
    );
  });

  it('cannot hide a duplicate queue notification inside the underlying API catch', async () => {
    vi.spyOn(PictureBookService.prototype, 'generateIllustration').mockImplementation(
      async function (this: PictureBookService) {
        const queue = this as unknown as {
          imageQueue: { notify: (id: string) => Promise<void> };
        };
        await queue.imageQueue.notify(illustrationId);
        try {
          await queue.imageQueue.notify(illustrationId);
        } catch {
          // Mirrors PictureBookService swallowing a queue notification error.
        }
        return {
          pictureBookId: bookId,
          pageId: page1Id,
          revisionNumber: 1,
          illustrationId,
          status: 'QUEUED' as const,
        };
      },
    );
    const prepare = createI111SourceBoundFormalApiService(db);
    await expect(prepare.prepareViaFormalApi(input())).rejects.toThrow(
      'I111_SOURCE_BOUND_API_STOP',
    );
  });
});
