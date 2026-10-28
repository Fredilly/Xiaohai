import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMiniProgramStagingUrl,
  probeApiReady,
  probeBosObject,
  validateHttpsPublicUrl,
  validatePaidImageConfiguration,
  validatePublicBosObjectUrl,
} from './release-preflight.mjs';

test('release preflight extracts and validates a real HTTPS Mini Program staging API', () => {
  const source = `
const apiBaseUrlByEnvironment = {
  dev: 'http://127.0.0.1:3000',
  staging: 'https://staging-api.example.com',
  production: 'https://api.example.com',
};
`;
  const staging = extractMiniProgramStagingUrl(source);
  assert.equal(staging, 'https://staging-api.example.com');
  assert.deepEqual(validateHttpsPublicUrl(staging, 'Mini Program staging API'), []);
});

test('release preflight blocks localhost and placeholder staging domains', () => {
  assert.ok(validateHttpsPublicUrl('http://127.0.0.1:3000', 'API').length > 0);
  assert.ok(validateHttpsPublicUrl('https://staging-api.example.invalid', 'API').length > 0);
});

test('release preflight requires budgeted Bailian configuration without exposing values', () => {
  const failures = validatePaidImageConfiguration({
    PICTURE_BOOK_IMAGE_ENABLED: 'true',
    PICTURE_BOOK_IMAGE_PROVIDER: 'BAILIAN',
    PICTURE_BOOK_IMAGE_BUDGET_ENABLED: 'false',
  });
  assert.ok(failures.some((item) => item.includes('PICTURE_BOOK_IMAGE_BUDGET_ENABLED')));
  assert.ok(failures.some((item) => item.includes('BAIDU_BOS_PUBLIC_ORIGIN')));
  assert.equal(
    failures.some((item) => item.includes('secret')),
    false,
  );
});

test('release preflight rejects signed or off-origin BOS smoke URLs', () => {
  assert.ok(
    validatePublicBosObjectUrl(
      'https://assets.example.com/smoke.png?signature=secret',
      'https://assets.example.com',
    ).length > 0,
  );
  assert.ok(
    validatePublicBosObjectUrl('https://other.example.com/smoke.png', 'https://assets.example.com')
      .length > 0,
  );
  assert.deepEqual(
    validatePublicBosObjectUrl(
      'https://assets.example.com/preflight/public-smoke.png',
      'https://assets.example.com',
    ),
    [],
  );
});

test('release preflight probes API readiness and a public BOS object without provider calls', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method });
    if (String(url).endsWith('/ready')) {
      return {
        ok: true,
        json: async () => ({ status: 'ready' }),
      };
    }
    return { ok: true };
  };

  assert.equal(await probeApiReady('https://staging-api.example.com', fetchImpl), true);
  assert.equal(
    await probeBosObject('https://assets.example.com/preflight/public-smoke.png', fetchImpl),
    true,
  );
  assert.deepEqual(calls, [
    { url: 'https://staging-api.example.com/ready', method: 'GET' },
    { url: 'https://assets.example.com/preflight/public-smoke.png', method: 'HEAD' },
  ]);
});

const validPaidImageEnvironment = {
  PICTURE_BOOK_IMAGE_ENABLED: 'true',
  PICTURE_BOOK_IMAGE_PROVIDER: 'BAILIAN',
  PICTURE_BOOK_IMAGE_BUDGET_ENABLED: 'true',
  PICTURE_BOOK_IMAGE_MODEL: 'qwen-image-3.0',
  PICTURE_BOOK_IMAGE_BASE_URL: 'https://dashscope.aliyuncs.com',
  BAIDU_BOS_PUBLIC_ORIGIN: 'https://assets.example.com',
  PICTURE_BOOK_IMAGE_BUDGET_KEY: 'image-daily',
  PICTURE_BOOK_IMAGE_BUDGET_WINDOW_KEY: '2099-01-01',
  PICTURE_BOOK_IMAGE_BUDGET_RESERVATION_MINOR: '100',
  PICTURE_BOOK_IMAGE_BUDGET_GLOBAL_LIMIT_MINOR: '1000',
  PICTURE_BOOK_IMAGE_BUDGET_CONSUMER_LIMIT_MINOR: '500',
  BOS_PREFLIGHT_OBJECT_URL: 'https://assets.example.com/preflight/health.png',
};

test('paid-image preflight accepts positive integer budgets at their limits', () => {
  const env = {
    ...validPaidImageEnvironment,
    PICTURE_BOOK_IMAGE_BUDGET_RESERVATION_MINOR: '500',
    PICTURE_BOOK_IMAGE_BUDGET_GLOBAL_LIMIT_MINOR: '500',
  };
  assert.deepEqual(validatePaidImageConfiguration(env), []);
});

test('paid-image preflight rejects nonpositive, fractional and unsafe budget numbers', () => {
  const fields = [
    'PICTURE_BOOK_IMAGE_BUDGET_RESERVATION_MINOR',
    'PICTURE_BOOK_IMAGE_BUDGET_GLOBAL_LIMIT_MINOR',
    'PICTURE_BOOK_IMAGE_BUDGET_CONSUMER_LIMIT_MINOR',
  ];
  const invalid = ['0', '-1', '0.5', '1e3', 'Infinity', 'NaN', '9007199254740992', ' 3'];
  for (const key of fields) {
    for (const value of invalid) {
      const failures = validatePaidImageConfiguration({
        ...validPaidImageEnvironment,
        [key]: value,
      });
      assert.ok(
        failures.some((failure) => failure.includes(key) && failure.includes('positive safe integer')),
        `${key} must reject malformed minor units`,
      );
    }
  }
});

test('paid-image preflight blocks reservation exceeding either daily cap', () => {
  for (const limit of [
    'PICTURE_BOOK_IMAGE_BUDGET_GLOBAL_LIMIT_MINOR',
    'PICTURE_BOOK_IMAGE_BUDGET_CONSUMER_LIMIT_MINOR',
  ]) {
    const failures = validatePaidImageConfiguration({
      ...validPaidImageEnvironment,
      [limit]: '99',
    });
    assert.ok(failures.some((failure) => failure.includes('exceeds a configured budget limit')));
  }
});

test('paid-image preflight rejects missing numeric fields without exposing values', () => {
  const env = { ...validPaidImageEnvironment };
  delete env.PICTURE_BOOK_IMAGE_BUDGET_GLOBAL_LIMIT_MINOR;
  const failures = validatePaidImageConfiguration(env);
  assert.ok(failures.some((failure) => failure.includes('GLOBAL_LIMIT_MINOR') && failure.includes('required')));
  assert.equal(failures.some((failure) => failure.includes('dashscope.aliyuncs.com')), false);
});
