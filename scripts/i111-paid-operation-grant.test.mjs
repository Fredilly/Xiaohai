import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyI111PaidGrant,
  verifyI111PaidGrantFromGitHub,
  verifyI111OwnerGrantPort,
} from './i111-paid-operation-grant.mjs';
import { I111_ONE_SHOT_SCOPE as scope } from './i111-one-shot-policy.mjs';

const sha = 'a'.repeat(40);
const createdAt = '2026-11-19T10:00:00Z';
const nowMs = Date.parse('2026-11-19T10:30:00Z');

async function withFetchStub(stub, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await callback();
  } finally {
    globalThis.fetch = original;
  }
}

function comment(overrides = {}, grantOverrides = {}) {
  return {
    id: 700_000_000_001,
    user: { login: 'Fredilly', id: 1532017 },
    author_association: 'OWNER',
    created_at: createdAt,
    updated_at: createdAt,
    body: JSON.stringify({
      schemaVersion: 1,
      kind: 'I111_PAID_OPERATION_GRANT',
      repository: 'Fredilly/Xiaohai',
      issueNumber: 111,
      codeSha: sha,
      bookId: scope.bookId,
      slots: [1, 2, 3],
      maxCalls: 3,
      maxSpendMinor: 200,
      noRetry: true,
      allowedResource: 'MAC_GATE_B_FIXED_PLAN_B',
      expiresAt: '2026-11-20T09:59:59Z',
      ...grantOverrides,
    }),
    html_url: 'https://github.com/Fredilly/Xiaohai/issues/111#issuecomment-700000000001',
    ...overrides,
  };
}

const args = { codeSha: sha, nowMs, nextSlot: 1 };

test('one exact independently sourced batch grant covers three slots', () => {
  assert.equal(classifyI111PaidGrant([comment()], args), 'MATCHES_SCHEMA_ONLY');
  assert.equal(classifyI111PaidGrant([comment()], { ...args, nextSlot: 2 }), 'MATCHES_SCHEMA_ONLY');
  assert.equal(classifyI111PaidGrant([comment()], { ...args, nextSlot: 3 }), 'MATCHES_SCHEMA_ONLY');
});

test('only a live fixed GitHub REST response can yield the executor sentinel', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, method: init.method });
    return {
      ok: true,
      status: 200,
      url,
      headers: { get: () => 'Thu, 19 Nov 2026 10:30:00 GMT' },
      json: async () => [comment()],
    };
  };
  assert.equal(
    await withFetchStub(fetchImpl, () => verifyI111PaidGrantFromGitHub(args)),
    'INDEPENDENT_VERIFIED_ONE_TIME_GRANT',
  );
  assert.deepEqual(requests, [
    {
      url: 'https://api.github.com/repos/Fredilly/Xiaohai/issues/111/comments?per_page=100&page=1',
      method: 'GET',
    },
  ]);
});

test('live approval rejects failed, malformed, redirected or spoofed GitHub data', async () => {
  const url =
    'https://api.github.com/repos/Fredilly/Xiaohai/issues/111/comments?per_page=100&page=1';
  const validHeaders = { get: () => 'Thu, 19 Nov 2026 10:30:00 GMT' };
  for (const response of [
    { ok: false },
    {
      ok: true,
      status: 200,
      url,
      headers: validHeaders,
      json: async () => ({ message: 'rate limited' }),
    },
    {
      ok: true,
      status: 200,
      url,
      headers: validHeaders,
      json: async () => [comment({ html_url: 'https://attacker.test/' })],
    },
    { ok: true, status: 200, url, headers: validHeaders, json: async () => [comment({ id: NaN })] },
    {
      ok: true,
      status: 200,
      url: 'https://attacker.test/',
      headers: validHeaders,
      json: async () => [comment()],
    },
    { ok: true, status: 200, url, headers: { get: () => null }, json: async () => [comment()] },
  ]) {
    assert.equal(
      await withFetchStub(
        async () => response,
        () => verifyI111PaidGrantFromGitHub(args),
      ),
      'STOP',
    );
  }
  assert.equal(
    await withFetchStub(
      async () => ({
        ok: true,
        status: 200,
        url,
        headers: { get: () => 'Fri, 20 Nov 2026 10:30:00 GMT' },
        json: async () => [comment()],
      }),
      () => verifyI111PaidGrantFromGitHub(args),
    ),
    'STOP',
  );
  assert.equal(
    await withFetchStub(
      async () => {
        throw new Error('secret should not escape');
      },
      () => verifyI111PaidGrantFromGitHub(args),
    ),
    'STOP',
  );
});

test('orchestration owner-grant port accepts only the exact frozen slot and scope', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    url,
    headers: { get: () => 'Thu, 19 Nov 2026 10:30:00 GMT' },
    json: async () => [comment()],
  });
  const details = {
    exactCodeSha: sha,
    bookId: scope.bookId,
    pageId: scope.page1Id,
    revisionNumber: 1,
    maxCalls: 3,
    maxSpendMinor: 200,
  };
  assert.equal(
    await withFetchStub(fetchImpl, () => verifyI111OwnerGrantPort(details)),
    'INDEPENDENT_VERIFIED_ONE_TIME_GRANT',
  );
  for (const wrong of [
    { exactCodeSha: 'unreviewed' },
    { bookId: 'wrong-book' },
    { pageId: scope.coverId },
    { pageId: scope.page2Id },
    { revisionNumber: 2 },
    { maxCalls: 4 },
    { maxSpendMinor: 201 },
  ]) {
    assert.equal(
      await withFetchStub(
        async () => {
          throw new Error('a rejected scope must not query GitHub');
        },
        () => verifyI111OwnerGrantPort({ ...details, ...wrong }),
      ),
      'STOP',
    );
  }
});

test('missing, ambiguous and malformed records fail closed', () => {
  for (const comments of [
    [],
    null,
    [comment(), comment({ id: 700_000_000_002 })],
    [comment({ body: 'APPROVED' })],
    [comment({ body: '{' })],
    [comment({ user: { login: 'lixia67', id: 190354141 } })],
    [comment({ user: { login: 'Fredilly', id: 'not-an-id' } })],
    [comment({ author_association: 'COLLABORATOR' })],
    [comment({ updated_at: '2026-11-19T10:01:00Z' })],
  ]) {
    assert.equal(classifyI111PaidGrant(comments, args), 'STOP');
  }
});

test('commit, slot, book, budget and retry mismatches fail closed', () => {
  for (const change of [
    { codeSha: 'b'.repeat(40) },
    { slots: [2, 3] },
    { slots: [1, 2, 2] },
    { bookId: '00000000-0000-0000-0000-000000000000' },
    { noRetry: false },
    { maxCalls: 4 },
    { maxSpendMinor: 201 },
    { allowedResource: 'production' },
    { repository: 'Fredilly/Other' },
    { issueNumber: 101 },
    { expiresAt: '2026-11-21T10:00:00Z' },
    { extra: 'untrusted' },
  ]) {
    assert.equal(classifyI111PaidGrant([comment({}, change)], args), 'STOP');
  }
});

test('expiration and untrusted time fail closed', () => {
  for (const changed of [
    { nowMs: Date.parse('2026-11-20T10:00:00Z') },
    { nowMs: Date.parse('2026-11-19T09:59:59Z') },
    { nowMs: Number.NaN },
    { codeSha: 'bad' },
    { nextSlot: 4 },
  ]) {
    assert.equal(classifyI111PaidGrant([comment()], { ...args, ...changed }), 'STOP');
  }
});

test('free-form code review and historical grants never authorize paid execution', () => {
  assert.equal(
    classifyI111PaidGrant(
      [
        comment({
          body: 'APPROVED PR #239 code only. No Phase A/B execution or paid model calls.',
        }),
      ],
      args,
    ),
    'STOP',
  );
  assert.equal(
    classifyI111PaidGrant([comment({}, { expiresAt: '2026-11-19T10:00:00Z' })], args),
    'STOP',
  );
});
