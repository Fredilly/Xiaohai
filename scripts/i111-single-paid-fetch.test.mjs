import test from 'node:test';
import assert from 'node:assert/strict';
import { createI111SinglePaidFetch } from './i111-single-paid-fetch.mjs';

const workspaceId = 'ws-31e71dbr72cfr5th';
const endpoint = `https://${workspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/images/generations`;
const download = 'https://example-oss.cn-beijing.aliyuncs.com/safe-output.png';
const refs = [
  'https://xiaohai-i111-work-2ec3900280.cd.bcebos.com/picture-books/ref-1.png?signature=a',
  'https://xiaohai-i111-work-2ec3900280.cd.bcebos.com/picture-books/ref-2.png?signature=b',
];

function paid(body = {}) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer masked' },
    body: JSON.stringify({
      model: 'qwen-image-3.0',
      prompt: 'Make exactly one illustration',
      image: refs,
      n: 1,
      size: '1024x1024',
      ...body,
    }),
  };
}

function harness(fetcher = async () => new Response('{}', { status: 200 })) {
  const calls = [];
  const guarded = createI111SinglePaidFetch({
    workspaceId,
    fetcher: async (...args) => {
      calls.push(args);
      return fetcher(...args);
    },
  });
  return { ...guarded, calls };
}

test('one exact paid POST and one download, with redirect following forbidden', async () => {
  const h = harness();
  await h.fetcher(endpoint, paid());
  await h.fetcher(download, { redirect: 'error' });
  assert.deepEqual(h.usageSummary(), {
    paidPostConsumed: true,
    paidPostSucceeded: true,
    imageDownloadConsumed: true,
    paidExecutionAuthorized: false,
  });
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0][1].redirect, 'error');
  await assert.rejects(h.fetcher(endpoint, paid()), /I111_IMAGE_TRANSPORT_STOP/u);
  await assert.rejects(h.fetcher(download, { redirect: 'error' }));
  assert.equal(h.calls.length, 2);
});

test('wrong model, endpoint, count, resolution, images or extra JSON never reaches network', async () => {
  const badCases = [
    [endpoint, paid({ model: 'qwen-image-3.0-pro' })],
    [endpoint, paid({ n: 2 })],
    [endpoint, paid({ size: '2048x2048' })],
    [endpoint, paid({ image: refs.slice(0, 1) })],
    [endpoint, paid({ image: [refs[0], refs[0]] })],
    [endpoint, paid({ image: [refs[0], 'http://host.invalid/ref'] })],
    [endpoint, paid({ image: [refs[0], 'https://evil.invalid/2'] })],
    [endpoint, paid({ extra: true })],
    [endpoint, paid({ prompt: '' })],
    [endpoint.replace('cn-beijing', 'ap-southeast'), paid()],
    [endpoint, { ...paid(), method: 'GET' }],
  ];
  for (const [url, input] of badCases) {
    const h = harness();
    await assert.rejects(h.fetcher(url, input), /I111_IMAGE_TRANSPORT_STOP/u);
    await assert.rejects(h.fetcher(endpoint, paid()));
    assert.equal(h.calls.length, 0);
  }
});

test('a transport timeout consumes the paid POST before awaiting: never retry', async () => {
  const h = harness(async () => {
    throw new Error('secret provider failure');
  });
  await assert.rejects(h.fetcher(endpoint, paid()), (error) => {
    assert.equal(error.message, 'I111_IMAGE_TRANSPORT_STOP');
    return true;
  });
  await assert.rejects(h.fetcher(endpoint, paid()));
  assert.equal(h.calls.length, 1);
  assert.equal(h.usageSummary().paidPostConsumed, true);
  assert.equal(h.usageSummary().paidPostSucceeded, false);
});

test('HTTP failure consumes the only POST and forbids image download', async () => {
  const h = harness(async () => new Response('untrusted error', { status: 429 }));
  const response = await h.fetcher(endpoint, paid());
  assert.equal(response.status, 429);
  await assert.rejects(h.fetcher(download, { redirect: 'error' }));
  await assert.rejects(h.fetcher(endpoint, paid()));
  assert.equal(h.calls.length, 1);
});

test('unexpected download method, host or redirect permanently poisons the guard', async () => {
  for (const [url, init] of [
    [download, { redirect: 'follow' }],
    [download, { method: 'POST', redirect: 'error' }],
    ['https://attacker.invalid/a.png', { redirect: 'error' }],
    ['not-a-url', { redirect: 'error' }],
  ]) {
    const h = harness();
    await h.fetcher(endpoint, paid());
    await assert.rejects(h.fetcher(url, init), /I111_IMAGE_TRANSPORT_STOP/u);
    await assert.rejects(h.fetcher(download, { redirect: 'error' }));
    assert.equal(h.calls.length, 1);
  }
});

test('a failed download may not be retried and never starts another paid POST', async () => {
  const h = harness(async (url) => {
    if (url === endpoint) return new Response('{}', { status: 200 });
    throw new Error('download failed');
  });
  await h.fetcher(endpoint, paid());
  await assert.rejects(h.fetcher(download, { redirect: 'error' }));
  await assert.rejects(h.fetcher(download, { redirect: 'error' }));
  await assert.rejects(h.fetcher(endpoint, paid()));
  assert.equal(h.calls.length, 2);
  assert.equal(h.usageSummary().imageDownloadConsumed, true);
});

test('no arbitrary workspace IDs or untrusted fetchers', () => {
  for (const invalid of ['', 'other', 'ws-1234', 'ws-../../evil', 'ws-ABCDEF12345678']) {
    assert.throws(() => createI111SinglePaidFetch({ fetcher: fetch, workspaceId: invalid }));
  }
  assert.throws(() => createI111SinglePaidFetch({ fetcher: null, workspaceId }));
});
