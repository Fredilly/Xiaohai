import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, test } from 'node:test';
import {
  readHiddenValue,
  runSecretSet,
  setLocalSecret,
  validateSecretKey,
} from './set-local-secret.mjs';

const temporaryDirectories = [];
const fakeSecret = ['local', 'test', 'value'].join('-');

async function repository({ ignored = true, env } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaohai-secret-test-'));
  temporaryDirectories.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  await writeFile(path.join(root, '.gitignore'), ignored ? '.env\n.env.*\n!.env.example\n' : '');
  await writeFile(path.join(root, '.env.example'), 'APP_ENV=dev\nDASHSCOPE_API_KEY=\n');
  if (env !== undefined) await writeFile(path.join(root, '.env'), env);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((root) => rm(root, { recursive: true })));
});

test('creates .env from the example and writes a new key', async () => {
  const root = await repository();
  await setLocalSecret({ root, key: 'DASHSCOPE_API_KEY', value: fakeSecret });
  const content = await readFile(path.join(root, '.env'), 'utf8');
  assert.match(content, new RegExp(`DASHSCOPE_API_KEY=${fakeSecret}`));
  assert.match(content, /APP_ENV=dev/u);
  const status = execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' });
  assert.equal(
    status.split('\n').some((line) => line.endsWith(' .env')),
    false,
  );
});

test('replaces duplicate keys while preserving unrelated env content', async () => {
  const root = await repository({
    env: 'APP_ENV=dev\nDASHSCOPE_API_KEY=old-one\nKEEP_ME=yes\nDASHSCOPE_API_KEY=old-two\n',
  });
  await setLocalSecret({ root, key: 'DASHSCOPE_API_KEY', value: fakeSecret });
  const content = await readFile(path.join(root, '.env'), 'utf8');
  assert.equal(content.match(/^DASHSCOPE_API_KEY=/gmu)?.length, 1);
  assert.match(content, new RegExp(`DASHSCOPE_API_KEY=${fakeSecret}`));
  assert.match(content, /APP_ENV=dev\n/u);
  assert.match(content, /KEEP_ME=yes\n/u);
});

test('never includes the secret in command output', async () => {
  const root = await repository();
  let output = '';
  await runSecretSet({
    argv: ['DASHSCOPE_API_KEY'],
    cwd: root,
    output: { write: (text) => (output += text) },
    readValue: async (key, _input, target) => {
      target.write(`Enter value for ${key}: `);
      return fakeSecret;
    },
  });
  assert.doesNotMatch(output, new RegExp(fakeSecret));
  assert.match(output, /Enter value for DASHSCOPE_API_KEY:/u);
});

test('reads TTY input without echoing its characters', async () => {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (enabled) => {
    input.isRaw = enabled;
    return input;
  };
  let output = '';
  const pending = readHiddenValue('DASHSCOPE_API_KEY', input, {
    write: (text) => (output += text),
  });
  input.write(`${fakeSecret}\n`);

  assert.equal(await pending, fakeSecret);
  assert.doesNotMatch(output, new RegExp(fakeSecret));
  assert.equal(input.isRaw, false);
});

test('refuses to write when .env is not gitignored', async () => {
  const root = await repository({ ignored: false });
  await assert.rejects(
    setLocalSecret({ root, key: 'DASHSCOPE_API_KEY', value: fakeSecret }),
    /\.env is not ignored by Git/u,
  );
  await assert.rejects(readFile(path.join(root, '.env'), 'utf8'), { code: 'ENOENT' });
});

test('fails clearly for invalid arguments and secret names', async () => {
  const root = await repository();
  await assert.rejects(
    runSecretSet({ argv: [], cwd: root }),
    /Usage: pnpm secret:set SECRET_NAME/u,
  );
  await assert.rejects(runSecretSet({ argv: ['bad-name'], cwd: root }), /Secret name must match/u);
  assert.throws(() => validateSecretKey('KEY=value'), /Secret name must match/u);
});
