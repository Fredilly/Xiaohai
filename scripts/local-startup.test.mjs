import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readPackage = async (path) => JSON.parse(await readFile(path, 'utf8'));

test('API and Worker dev scripts load the same repository-root .env', async () => {
  const [api, worker] = await Promise.all([
    readPackage('apps/api/package.json'),
    readPackage('apps/worker/package.json'),
  ]);
  const expected = '--env-file ../../.env';

  assert.match(api.scripts.dev, /--env-file \.\.\/\.\.\/\.env/u);
  assert.match(worker.scripts.dev, /--env-file \.\.\/\.\.\/\.env/u);
  assert.equal(api.scripts.dev.includes(expected), true);
  assert.equal(worker.scripts.dev.includes(expected), true);
});
