import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createI111DisabledTextQueue,
  createI111FormalApiWorkerPorts,
  createI111NoBroadcastImageQueue,
} from './i111-formal-api-worker-ports.mjs';
import { I111_ONE_SHOT_SCOPE as scope } from './i111-one-shot-policy.mjs';

const targetId = '00000000-1111-4222-8333-444444444444';
const input = {
  consumerUserId: scope.ownerId,
  pictureBookId: scope.bookId,
  pageId: scope.page1Id,
  regenerate: false,
};

function harness({ wrongCreated = {}, APIThrow = false, workerResult = targetId } = {}) {
  const calls = [];
  const imageQueue = createI111NoBroadcastImageQueue();
  const apiService = {
    async generateIllustration(...args) {
      calls.push(['formal-api', ...args]);
      if (APIThrow) throw new Error('secret provider token');
      await imageQueue.notify(targetId);
      return {
        pictureBookId: scope.bookId,
        pageId: scope.page1Id,
        revisionNumber: 1,
        illustrationId: targetId,
        status: 'QUEUED',
        ...wrongCreated,
      };
    },
  };
  const ports = createI111FormalApiWorkerPorts({
    apiService,
    imageQueue,
    createTargetWorker: async (id) => {
      calls.push(['target-worker-created', id]);
      return {
        async processOne() {
          calls.push(['target-worker-process-once']);
          if (workerResult instanceof Error) throw workerResult;
          return workerResult;
        },
      };
    },
  });
  return { ports, calls, imageQueue };
}

test('one exact formal API call, one no-broadcast notification, one targeted Worker call', async () => {
  const h = harness();
  assert.deepEqual(await h.ports.prepareViaFormalApi(input), {
    pictureBookId: scope.bookId,
    pageId: scope.page1Id,
    revisionNumber: 1,
    illustrationId: targetId,
    status: 'QUEUED',
  });
  assert.equal(h.imageQueue.notificationSummary(), 'SINGLE_NO_BROADCAST');
  assert.equal(await h.ports.processTargetIdOnce(targetId), targetId);
  assert.deepEqual(h.calls, [
    ['formal-api', scope.ownerId, scope.bookId, scope.page1Id, false],
    ['target-worker-created', targetId],
    ['target-worker-process-once'],
  ]);
});

test('a second API or Worker call is forbidden, even after a successful result', async () => {
  const h = harness();
  await h.ports.prepareViaFormalApi(input);
  await assert.rejects(h.ports.prepareViaFormalApi(input), /I111_FORMAL_API_WORKER_STOP/u);
  await h.ports.processTargetIdOnce(targetId);
  await assert.rejects(h.ports.processTargetIdOnce(targetId), /I111_FORMAL_API_WORKER_STOP/u);
  assert.equal(h.calls.length, 3);
});

test('invalid scope stops without entering formal API or Worker', async () => {
  for (const wrong of [
    { consumerUserId: 'wrong-user' },
    { pictureBookId: 'wrong-book' },
    { pageId: scope.coverId },
    { pageId: scope.page1Id, regenerate: true },
    { pageId: scope.page2Id, regenerate: 'true' },
    { extra: 'forbidden' },
  ]) {
    const h = harness();
    await assert.rejects(h.ports.prepareViaFormalApi({ ...input, ...wrong }));
    assert.equal(h.calls.length, 0);
  }
  assert.throws(() => createI111FormalApiWorkerPorts({}));
});

test('only fixed page/revision/regeneration combinations are accepted', async () => {
  for (const [pageId, revisionNumber, regenerate] of [
    [scope.page1Id, 1, false],
    [scope.page2Id, 1, false],
    [scope.page2Id, 2, true],
  ]) {
    const imageQueue = createI111NoBroadcastImageQueue();
    const ports = createI111FormalApiWorkerPorts({
      imageQueue,
      apiService: {
        async generateIllustration(user, book, page, next) {
          assert.deepEqual(
            [user, book, page, next],
            [scope.ownerId, scope.bookId, pageId, regenerate],
          );
          await imageQueue.notify(targetId);
          return {
            illustrationId: targetId,
            pictureBookId: book,
            pageId: page,
            revisionNumber,
            status: 'QUEUED',
          };
        },
      },
      createTargetWorker: async () => ({ processOne: async () => targetId }),
    });
    const result = await ports.prepareViaFormalApi({ ...input, pageId, regenerate });
    assert.equal(result.revisionNumber, revisionNumber);
  }
});

test('a pre-Worker invocation, wrong target ID or invalid API result cannot process anything', async () => {
  const h = harness();
  await assert.rejects(h.ports.processTargetIdOnce(targetId));
  assert.equal(h.calls.length, 0);
  await h.ports.prepareViaFormalApi(input);
  await assert.rejects(h.ports.processTargetIdOnce('00000000-1111-4222-8333-444444444449'));
  assert.equal(h.calls.length, 1);
  for (const wrongCreated of [
    { status: 'RUNNING' },
    { revisionNumber: 2 },
    { illustrationId: 'invalid' },
    { pageId: scope.page2Id },
    { pictureBookId: 'wrong-book' },
  ]) {
    const bad = harness({ wrongCreated });
    await assert.rejects(bad.ports.prepareViaFormalApi(input));
    await assert.rejects(bad.ports.processTargetIdOnce(targetId));
    assert.equal(bad.calls.length, 1);
  }
});

test('unknown outcome consumes its one attempt and never retries', async () => {
  const badApi = harness({ APIThrow: true });
  await assert.rejects(badApi.ports.prepareViaFormalApi(input), (error) => {
    assert.equal(error.message, 'I111_FORMAL_API_WORKER_STOP');
    return true;
  });
  await assert.rejects(badApi.ports.prepareViaFormalApi(input));
  assert.equal(badApi.calls.length, 1);
  for (const workerResult of [null, '00000000-1111-4222-8333-444444444449', new Error('secret')]) {
    const h = harness({ workerResult });
    await h.ports.prepareViaFormalApi(input);
    await assert.rejects(h.ports.processTargetIdOnce(targetId), (error) => {
      assert.equal(error.message, 'I111_FORMAL_API_WORKER_STOP');
      return true;
    });
    await assert.rejects(h.ports.processTargetIdOnce(targetId));
    assert.equal(h.calls.filter((event) => event[0] === 'target-worker-process-once').length, 1);
  }
});

test('no-broadcast queue rejects duplicate, malformed and unrelated notifications', async () => {
  const queue = createI111NoBroadcastImageQueue();
  assert.equal(queue.notificationSummary(), 'NONE');
  await assert.rejects(queue.notify('bad'));
  assert.equal(queue.notificationSummary(), 'VIOLATION');
  await assert.rejects(queue.notify(targetId));
  const accepted = createI111NoBroadcastImageQueue();
  await accepted.notify(targetId);
  await assert.rejects(accepted.notify(targetId));
  assert.equal(accepted.notificationSummary(), 'VIOLATION');
  assert.equal(queue.notificationSummary(), 'VIOLATION');
  assert.equal(accepted.confirmedNotificationId(), targetId);
  assert.throws(
    () => createI111DisabledTextQueue().enqueue('other'),
    /I111_FORMAL_API_WORKER_STOP/u,
  );
});
