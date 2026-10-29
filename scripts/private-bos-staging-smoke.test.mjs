import assert from 'node:assert/strict';
import test from 'node:test';
import { runPrivateBosSmoke, validatePrivateBosSmoke } from './private-bos-staging-smoke.mjs';

const host = 'xiaohai-staging-assets.bj.bcebos.com';
const path = '/picture-books/synthetic-smoke.png';
const base = {
  BAIDU_BOS_BUCKET: 'xiaohai-staging-assets',
  BAIDU_BOS_ENDPOINT: 'https://bj.bcebos.com',
  BAIDU_BOS_PUBLIC_ORIGIN: 'https://' + host,
  BOS_PRIVATE_SMOKE_UNSIGNED_URL: 'https://' + host + path,
  BOS_PRIVATE_SMOKE_SIGNED_URL: 'https://' + host + path + '?authorization=valid-sensitive',
  BOS_PRIVATE_SMOKE_EXPIRED_URL: 'https://' + host + path + '?authorization=expired-sensitive',
};

test('validates a single scoped synthetic private object without logging URLs', () => {
  const result = validatePrivateBosSmoke(base);
  assert.deepEqual(result.failures, []);
  assert.equal(result.unsigned.pathname, path);
});

test('rejects mixed buckets, localhost, unsafe keys and missing/identical signatures', () => {
  for (const overrides of [
    { BAIDU_BOS_ENDPOINT: 'http://bj.bcebos.com' },
    { BAIDU_BOS_PUBLIC_ORIGIN: 'https://other.bj.bcebos.com' },
    { BOS_PRIVATE_SMOKE_SIGNED_URL: 'https://attacker.example/' + path + '?token=1' },
    { BOS_PRIVATE_SMOKE_SIGNED_URL: 'https://' + host + '/other/image.png?token=1' },
    { BOS_PRIVATE_SMOKE_UNSIGNED_URL: 'https://' + host + path + '?token=oops' },
    { BOS_PRIVATE_SMOKE_EXPIRED_URL: base.BOS_PRIVATE_SMOKE_SIGNED_URL },
    { BOS_PRIVATE_SMOKE_SIGNED_URL: 'https://' + host + '/picture-books/../other.png?token=1' },
    { BOS_PRIVATE_SMOKE_SIGNED_URL: 'https://' + host + '/picture-books/%2e%2e/other.png?token=1' },
    { BOS_PRIVATE_SMOKE_SIGNED_URL: '' },
  ]) {
    assert.notEqual(validatePrivateBosSmoke({ ...base, ...overrides }).failures.length, 0);
  }
});

test('passes only private 403, signed image 200, expired 403 and never prints secrets', async () => {
  const urls = [];
  const output = [];
  const logger = {
    log: (message) => output.push(message),
    error: (message) => output.push(message),
  };
  const statuses = [403, 200, 403];
  const fetchImpl = async (url, options) => {
    urls.push(url.toString());
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    const status = statuses[urls.length - 1];
    return new Response(status === 200 ? 'image' : null, {
      status,
      headers: { 'content-type': status === 200 ? 'image/png' : 'application/xml' },
    });
  };
  const exit = await runPrivateBosSmoke({ env: base, fetchImpl, logger });
  assert.equal(exit, 0);
  assert.equal(urls.length, 3);
  assert.equal(output.filter((line) => line.includes('PASS')).length, 4);
  assert.doesNotMatch(output.join(' '), /valid-sensitive|expired-sensitive|authorization=/);
});

test('rejects public-read, expired success, redirects and wrong content type', async () => {
  for (const scenario of [
    { statuses: [200, 200, 403], badMime: false },
    { statuses: [403, 200, 200], badMime: false },
    { statuses: [403, 302, 403], badMime: false },
    { statuses: [403, 200, 403], badMime: true },
  ]) {
    let index = 0;
    const logger = { log: () => {}, error: () => {} };
    const fetchImpl = async () => {
      const status = scenario.statuses[index++];
      return new Response(status === 200 ? 'image' : null, {
        status,
        headers: {
          'content-type':
            status === 200 && !scenario.badMime ? 'image/png' : 'text/plain',
        },
      });
    };
    assert.equal(await runPrivateBosSmoke({ env: base, fetchImpl, logger }), 1);
  }
});

test('fails closed on network errors without printing signed URLs', async () => {
  const output = [];
  const logger = { log: () => {}, error: (message) => output.push(message) };
  const exit = await runPrivateBosSmoke({
    env: base,
    fetchImpl: async () => {
      throw new Error('secret:authorization=must-not-leak');
    },
    logger,
  });
  assert.equal(exit, 1);
  assert.doesNotMatch(output.join(' '), /secret|authorization/);
});
