import test from 'node:test';
import assert from 'node:assert/strict';
import { createI111SourceBoundComposition } from './i111-source-bound-composition.mjs';
import { I111_ONE_SHOT_SCOPE as scope } from './i111-one-shot-policy.mjs';
import { coordinateI111OneShot } from './i111-one-shot-orchestration.mjs';
import { PictureBookService } from '../apps/api/dist/picture-book/picture-book-service.js';
import { ImageJobProcessor } from '../apps/worker/dist/image-processor.js';

const STOP = /I111_SOURCE_BOUND_COMPOSITION_STOP/u;
const ID = '00000000-1111-4222-8333-444444444444';
const SLOTS = [
  { pageId: scope.page1Id, revisionNumber: 1, regenerate: false },
  { pageId: scope.page2Id, revisionNumber: 1, regenerate: false },
  { pageId: scope.page2Id, revisionNumber: 2, regenerate: true },
];
const db = { transaction: async () => null };

function options() {
  return {
    db,
    workspaceId: 'ws-31e71dbr72cfr5th',
    apiKey: 'dummy-key-for-local-test',
    imageTimeoutMs: 600_000,
    bos: {
      endpoint: 'https://cd.bcebos.com/',
      bucket: 'xiaohai-i111-work-2ec3900280',
      publicOrigin: 'https://xiaohai-i111-work-2ec3900280.cd.bcebos.com/',
      accessKeyId: 'dummy-bos-access',
      secretAccessKey: 'dummy-bos-secret',
    },
  };
}

function request(slot) {
  return {
    consumerUserId: scope.ownerId,
    pictureBookId: scope.bookId,
    pageId: slot.pageId,
    regenerate: slot.regenerate,
  };
}

function withMockedProductionMethods(run, { apiFailure = false, workerFailure = false } = {}) {
  const previousEnv = process.env.APP_ENV;
  const previousFetch = globalThis.fetch;
  const oldApi = PictureBookService.prototype.generateIllustration;
  const oldWorker = ImageJobProcessor.prototype.processOne;
  const calls = { api: 0, worker: 0, fetch: 0 };
  process.env.APP_ENV = 'dev';
  globalThis.fetch = async () => {
    calls.fetch += 1;
    throw new Error('NETWORK_FORBIDDEN');
  };
  PictureBookService.prototype.generateIllustration = async function (
    owner,
    book,
    page,
    regenerate,
  ) {
    calls.api += 1;
    if (apiFailure) throw new Error('UNKNOWN_API_COMMIT');
    assert.equal(owner, scope.ownerId);
    assert.equal(book, scope.bookId);
    const slot = SLOTS.find((s) => s.pageId === page && s.regenerate === regenerate);
    assert.ok(slot);
    await this.imageQueue.notify(ID);
    return {
      pictureBookId: book,
      pageId: page,
      revisionNumber: slot.revisionNumber,
      illustrationId: ID,
      status: 'QUEUED',
    };
  };
  ImageJobProcessor.prototype.processOne = async function () {
    calls.worker += 1;
    if (workerFailure) throw new Error('UNKNOWN_MARKER_OR_PROVIDER_OUTCOME');
    return ID;
  };

  return Promise.resolve()
    .then(() => run(calls))
    .finally(() => {
      if (previousEnv === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previousEnv;
      globalThis.fetch = previousFetch;
      PictureBookService.prototype.generateIllustration = oldApi;
      ImageJobProcessor.prototype.processOne = oldWorker;
    });
}

test('construction is inert and is not an independently usable coordinator', async () => {
  await withMockedProductionMethods(async (calls) => {
    const ports = await createI111SourceBoundComposition(options());
    assert.deepEqual(Object.keys(ports).sort(), [
      'prepareViaFormalApi',
      'processTargetIdWithAtomicGateOnce',
    ]);
    assert.deepEqual(await coordinateI111OneShot(ports), {
      verdict: 'STOP',
      errorCode: 'I111_EXECUTOR_PORTS_UNAVAILABLE',
      paidExecutionAuthorized: false,
    });
    assert.deepEqual(calls, { api: 0, worker: 0, fetch: 0 });
    await assert.rejects(
      ports.processTargetIdWithAtomicGateOnce({ targetId: ID, slot: SLOTS[0] }),
      STOP,
    );
    await assert.rejects(
      ports.processTargetIdWithAtomicGateOnce({ targetId: ID, slot: SLOTS[0] }),
      STOP,
    );
    assert.deepEqual(calls, { api: 0, worker: 0, fetch: 0 });
  });
});

test('malformed preparation input cannot invoke the formal API or be retried', async () => {
  await withMockedProductionMethods(async (calls) => {
    const ports = await createI111SourceBoundComposition(options());
    await assert.rejects(
      ports.prepareViaFormalApi({ ...request(SLOTS[0]), unexpected: true }),
      STOP,
    );
    await assert.rejects(ports.prepareViaFormalApi(request(SLOTS[0])), STOP);
    assert.deepEqual(calls, { api: 0, worker: 0, fetch: 0 });
  });
});

test('all three prepared slots bind the exact illustration to the same real Worker class', async () => {
  await withMockedProductionMethods(async (calls) => {
    for (const slot of SLOTS) {
      const ports = await createI111SourceBoundComposition(options());
      const created = await ports.prepareViaFormalApi(request(slot));
      assert.equal(created.illustrationId, ID);
      assert.equal(await ports.processTargetIdWithAtomicGateOnce({ targetId: ID, slot }), ID);
      await assert.rejects(ports.processTargetIdWithAtomicGateOnce({ targetId: ID, slot }), STOP);
    }
    assert.deepEqual(calls, { api: 3, worker: 3, fetch: 0 });
  });
});

test('rejects all six legal-slot swaps and wrong target before Worker processing', async () => {
  await withMockedProductionMethods(async (calls) => {
    for (let expected = 0; expected < SLOTS.length; expected += 1) {
      for (let provided = 0; provided < SLOTS.length; provided += 1) {
        if (expected === provided) continue;
        const ports = await createI111SourceBoundComposition(options());
        await ports.prepareViaFormalApi(request(SLOTS[expected]));
        await assert.rejects(
          ports.processTargetIdWithAtomicGateOnce({ targetId: ID, slot: SLOTS[provided] }),
          STOP,
        );
      }
    }
    const ports = await createI111SourceBoundComposition(options());
    await ports.prepareViaFormalApi(request(SLOTS[0]));
    await assert.rejects(
      ports.processTargetIdWithAtomicGateOnce({ targetId: crypto.randomUUID(), slot: SLOTS[0] }),
      STOP,
    );
    assert.deepEqual(calls, { api: 7, worker: 0, fetch: 0 });
  });
});

test('unknown API transaction and unknown Worker outcome are consumed without retry', async () => {
  await withMockedProductionMethods(
    async (calls) => {
      const ports = await createI111SourceBoundComposition(options());
      await assert.rejects(ports.prepareViaFormalApi(request(SLOTS[0])), STOP);
      await assert.rejects(ports.prepareViaFormalApi(request(SLOTS[0])), STOP);
      assert.deepEqual(calls, { api: 1, worker: 0, fetch: 0 });
    },
    { apiFailure: true },
  );

  await withMockedProductionMethods(
    async (calls) => {
      const ports = await createI111SourceBoundComposition(options());
      await ports.prepareViaFormalApi(request(SLOTS[0]));
      await assert.rejects(
        ports.processTargetIdWithAtomicGateOnce({ targetId: ID, slot: SLOTS[0] }),
        STOP,
      );
      await assert.rejects(
        ports.processTargetIdWithAtomicGateOnce({ targetId: ID, slot: SLOTS[0] }),
        STOP,
      );
      assert.deepEqual(calls, { api: 1, worker: 1, fetch: 0 });
    },
    { workerFailure: true },
  );
});

test('production environment stops before API or Worker construction', async () => {
  const previousEnv = process.env.APP_ENV;
  process.env.APP_ENV = 'production';
  try {
    await assert.rejects(createI111SourceBoundComposition(options()), STOP);
  } finally {
    if (previousEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previousEnv;
  }
});
