import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('./staging-image-retention.sh', import.meta.url).pathname;
const current = 'e38a1796b7f6eb08a7b10932567c5b781eed606c';
const rollbackA = 'f8e1fe86bbb904a4e7871901442a5b3dac7890e0';
const rollbackB = 'd79ca0ff400f52f05a140235565b9c981163ead5';
const old = 'c'.repeat(40);
const id = (hex) => `sha256:${hex.repeat(64)}`;
const api = (tag) => `ghcr.io/fredilly/xiaohai-api:${tag}`;
const worker = (tag) => `ghcr.io/fredilly/xiaohai-worker:${tag}`;

function baseImages() {
  return Object.fromEntries([
    [api(current), id('1')], [worker(current), id('2')],
    [api(rollbackA), id('3')], [worker(rollbackA), id('4')],
    [api(rollbackB), id('5')], [worker(rollbackB), id('6')],
    ['postgres:17-alpine', id('7')], ['redis:7.4-alpine', id('8')], ['caddy:2-alpine', id('9')],
    [api(old), id('a')], [worker(old), id('b')],
  ]);
}

async function runRetention({ images = baseImages(), containers = [], aliases = {}, rollback = `${rollbackA} ${rollbackB}`, mode = '--dry-run', env = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'xiaohai-retention-'));
  const docker = join(dir, 'docker');
  await writeFile(docker, `#!/usr/bin/env node
const a = process.argv.slice(2);
const model = JSON.parse(process.env.DOCKER_FIXTURE);
const images = model.images;
const out = (s) => process.stdout.write(String(s) + '\\n');
if (a[0] === 'context' && a[1] === 'show') out('default');
else if (a[0] === 'ps' && a[1] === '-aq') model.containers.forEach(c => out(c.name));
else if (a[0] === 'image' && a[1] === 'ls') Object.keys(images).forEach(out);
else if (a[0] === 'image' && a[1] === 'inspect') {
  const ref = a[a.length - 1];
  if (!images[ref]) process.exit(1);
  if (a.includes('{{.Id}}')) out(images[ref]);
  else if (a.some(x => x.includes('RepoTags'))) (model.aliases[ref] || [ref]).forEach(out);
  else process.exit(2);
} else if (a[0] === 'inspect') {
  const key = a[a.length - 1];
  const c = model.containers.find(x => x.name === key);
  if (!c) process.exit(1);
  if (a.includes('{{.Image}}')) out(c.id);
  else if (a.includes('{{.Config.Image}}')) out(c.ref);
  else process.exit(2);
} else if (a[0] === 'image' && a[1] === 'rm') { out('UNEXPECTED_DELETE'); process.exit(99); }
else process.exit(2);
`);
  await chmod(docker, 0o755);
  // No fixture version is referenced by a deployment configuration.
  const grep = join(dir, 'grep');
  await writeFile(grep, '#!/bin/sh\nexit 1\n');
  await chmod(grep, 0o755);
  return spawnSync('bash', [script, mode], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${dir}:${process.env.PATH}`,
      DOCKER_FIXTURE: JSON.stringify({ images, containers, aliases }),
      STAGING_CURRENT_REVISION: current,
      STAGING_ROLLBACK_REVISIONS: rollback,
      STAGING_DEPLOY_LOCK: join(dir, 'lock'),
      ...env,
    },
  });
}

test('dry-run emits exact API+worker IDs and never calls removal', async () => {
  const r = await runRetention();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /AUDIT mode=--dry-run/);
  assert.match(r.stdout, new RegExp(old));
  assert.match(r.stdout, /deleted_pairs=0/);
  assert.doesNotMatch(r.stdout, /UNEXPECTED_DELETE/);
  assert.doesNotMatch(r.stderr, /STOP/); // grep exit 1 means no match, not an error
});

test('missing or ambiguous rollback mapping fails closed', async () => {
  for (const rollback of ['', `${rollbackA} ${rollbackA}`, `${rollbackA} ${current}`]) {
    const r = await runRetention({ rollback });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /STOP retention:/);
  }
});

test('stopped containers protect referenced image IDs and tags', async () => {
  const r = await runRetention({ containers: [{ name: 'stopped-1', ref: api(old), id: id('a') }] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /SKIP revision=/);
  assert.doesNotMatch(r.stdout, /AUDIT mode=--dry-run/);
});

test('shared aliases, incomplete pairs, and dangling images are never deleted', async () => {
  for (const fixture of [
    { aliases: { [api(old)]: [api(old), 'another-retained-tag'] } },
    { images: Object.fromEntries(Object.entries(baseImages()).filter(([k]) => k !== worker(old))) },
  ]) {
    const r = await runRetention(fixture);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /AUDIT mode=--dry-run/);
  }
  const r = await runRetention({ images: { ...baseImages(), 'ghcr.io/fredilly/xiaohai-api:<none>': id('f') } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /deleted_pairs=0/);
});

test('execute requires separate owner authorization and exact approved-ID manifest', async () => {
  const r = await runRetention({ mode: '--execute' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /execution not authorized/);
});
