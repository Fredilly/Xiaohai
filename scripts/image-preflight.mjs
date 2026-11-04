import { spawnSync } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import process from 'node:process';

export const DEFAULT_BUILD_TARGETS = [
  {
    label: '@xiaohai/config',
    source: 'packages/config/src',
    output: 'packages/config/dist/src/index.js',
  },
  {
    label: '@xiaohai/db',
    source: 'packages/db/src',
    output: 'packages/db/dist/src/index.js',
  },
  {
    label: '@xiaohai/worker',
    source: 'apps/worker/src',
    output: 'apps/worker/dist/index.js',
  },
];

async function newestMtime(path) {
  const info = await stat(path);
  if (!info.isDirectory()) return info.mtimeMs;

  const entries = await readdir(path, { withFileTypes: true });
  let newest = 0;
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    const childMtime = entry.isDirectory() ? await newestMtime(child) : (await stat(child)).mtimeMs;
    newest = Math.max(newest, childMtime);
  }
  return newest;
}

export async function findStaleBuilds(root, targets = DEFAULT_BUILD_TARGETS) {
  const failures = [];

  for (const target of targets) {
    const sourcePath = resolve(root, target.source);
    const outputPath = resolve(root, target.output);
    let outputMtime;

    try {
      outputMtime = (await stat(outputPath)).mtimeMs;
    } catch {
      failures.push({
        label: target.label,
        reason: 'MISSING_BUILD',
        output: target.output,
      });
      continue;
    }

    const sourceMtime = await newestMtime(sourcePath);
    if (sourceMtime > outputMtime) {
      failures.push({
        label: target.label,
        reason: 'STALE_BUILD',
        output: target.output,
      });
    }
  }

  return failures;
}

function run(command, args, root) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  return result.status ?? 1;
}

export async function runImagePreflight(root = process.cwd()) {
  const staleBuilds = await findStaleBuilds(root);
  if (staleBuilds.length > 0) {
    for (const failure of staleBuilds) {
      console.error(
        `${failure.label}: ${failure.reason === 'MISSING_BUILD' ? 'build output is missing' : 'build output is older than source'} (${failure.output}).`,
      );
    }
    console.error('Run "pnpm build" before any paid image job, then rerun this preflight.');
    return 1;
  }

  if (run('pnpm', ['--filter', '@xiaohai/db', 'db:check'], root) !== 0) {
    console.error('Database migration files failed drizzle-kit validation.');
    return 1;
  }

  if (run('pnpm', ['--filter', '@xiaohai/db', 'db:status'], root) !== 0) {
    return 1;
  }

  console.log(
    'Image preflight passed: builds are current and repository migrations are applied. No provider request was made.',
  );
  return 0;
}

const invokedDirectly =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = await runImagePreflight();
}
