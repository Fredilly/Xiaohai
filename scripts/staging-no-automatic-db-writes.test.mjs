import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../.github/workflows/staging-deploy.yml', import.meta.url),
  'utf8',
);

const forbiddenCommands = [
  /(?:pnpm|npm|yarn)\s+(?:--[^\s]+\s+)*db:(?:migrate|push|seed)\b/u,
  /\b(?:migrate|seed-staging-home-cli)\.js\b/u,
  /\b(?:psql|pg_restore|pg_dump)\b/u,
  /\b(?:INSERT|DELETE|TRUNCATE|ALTER\s+TABLE|CREATE\s+TABLE)\b/u,
];

function unexpectedWrites(source) {
  return forbiddenCommands.filter((pattern) => pattern.test(source)).map(String);
}

test('ordinary staging deployment contains no automatic schema, SQL or seed writes', () => {
  assert.deepEqual(unexpectedWrites(workflow), []);
  assert.match(workflow, /docker compose[^\n]+\bpull\b/u);
  assert.match(workflow, /docker compose[^\n]+\bup -d --remove-orphans\b/u);
});

test('migration guard rejects regression into the deployment SSH command', () => {
  const modified = workflow.replace(
    ' up -d --remove-orphans',
    ' run --rm --no-deps api node packages/db/dist/src/migrate.js && docker compose up -d --remove-orphans',
  );
  assert.notDeepEqual(unexpectedWrites(modified), []);
});

test('staging content seeding is also a separately approved operation', () => {
  const modified = workflow.replace(
    ' up -d --remove-orphans',
    ' run --rm --no-deps api node packages/db/dist/src/seed-staging-home-cli.js && docker compose up -d --remove-orphans',
  );
  assert.notDeepEqual(unexpectedWrites(modified), []);
});

test('the safety check fails on direct migration aliases', () => {
  for (const command of ['pnpm db:migrate', 'pnpm db:push', 'node migrate.js', 'psql']) {
    assert.notDeepEqual(unexpectedWrites(command), []);
  }
});
