#!/usr/bin/env node
// Pre-human-review gate. The PR diff is authoritative, not an old PR title.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function reviewIssues({ files, patch = '', body = '', readSource = () => '' }) {
  const issues = [];
  const has = (pattern) => files.some((file) => pattern.test(file));
  const migration = has(/^packages\/db\/migrations\/\d{4}_[^/]+\.sql$/);
  const hq =
    has(/^apps\/admin-web\/src\/catalog[-\w]*\.(?:ts|tsx)$/) ||
    has(/^apps\/api\/src\/commerce\/commerce-(?:service|routes)\.ts$/);
  const meiping =
    has(/^apps\/(?:api|admin-web|store-web)\/src\/migration\/meiping/) ||
    has(/^apps\/(?:api|admin-web|store-web)\/src\/meiping/);

  if (hq && meiping) issues.push('Unrelated HQ catalog and Meiping changes must be separated.');
  if (migration) {
    if (!has(/^docs\/[\w.-]*(?:MIGRATION|RUNBOOK|migration|runbook)[\w.-]*\.md$/)) {
      issues.push('New SQL migration requires a dedicated changed migration/runbook document.');
    }
    if (
      !/migration|迁移/i.test(body) ||
      !/rollback|恢复|回滚/i.test(body) ||
      !/reconcil|核对|对账|校验/i.test(body)
    ) {
      issues.push('Migration PR body must describe migration, rollback and reconciliation.');
    }
    if (hq) issues.push('Do not mix HQ catalog work with SQL migration.');
  }
  if (
    hq &&
    /(?:\bno\b|\bwithout\b|不涉及|不包含|不修改)[^\n.。]{0,55}(?:HQ|总部|Admin\s*Web)/i.test(body)
  ) {
    issues.push('PR description denies HQ changes but the diff contains them.');
  }
  if (
    migration &&
    /(?:\bno\b|\bwithout\b|不涉及|不包含|不修改)[^\n.。]{0,40}(?:migration|SQL|数据库迁移)/i.test(
      body,
    )
  ) {
    issues.push('PR description denies migration but the diff contains SQL migration.');
  }
  if (body.trim().length < 120 || !/test|CI|测试|验证/i.test(body)) {
    issues.push('Describe actual scope, risks and testing in the PR body.');
  }
  // Examine changed API routes only; test fixtures intentionally contain
  // unsafe examples and must not be mistaken for shipped response handlers.
  let publicRoute = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git a/')) {
      const path = /^diff --git a\/(.+?) b\//.exec(line)?.[1] ?? '';
      publicRoute = /^apps\/api\/src\/.*(?:routes|controller)\.ts$/.test(path);
    }
    if (!publicRoute || !line.startsWith('+') || line.startsWith('+++')) continue;
    if (
      /\bmessage\s*:\s*(?:(?:err|error)\??\.message\b|(?:err|error)\s+instanceof\b)/.test(
        line.slice(1),
      )
    ) {
      issues.push(
        'Raw exception text may be exposed in an HTTP response; use allowlisted messages.',
      );
      break;
    }
  }
  // Destructive DB integration suites must validate their effective target
  // before creating any connection. Check added suites and the exact unsafe
  // DATABASE_URL ternary across ALL modified suites.
  const addedIntegrationSuites = new Set();
  const deletedIntegrationSuites = new Set();
  let diffPath = '';
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git a/')) {
      diffPath = /^diff --git a\/(.+?) b\//.exec(line)?.[1] ?? '';
    } else if (
      line.startsWith('new file mode ') &&
      /^apps\/api\/test\/[^/]+\.integration\.test\.ts$/.test(diffPath)
    ) {
      addedIntegrationSuites.add(diffPath);
    } else if (
      line.startsWith('deleted file mode ') &&
      /^apps\/api\/test\/[^/]+\.integration\.test\.ts$/.test(diffPath)
    ) {
      deletedIntegrationSuites.add(diffPath);
    }
  }
  for (const file of files.filter((path) =>
    /^apps\/api\/test\/[^/]+\.integration\.test\.ts$/.test(path),
  )) {
    if (deletedIntegrationSuites.has(file)) continue;
    // Deleted test files have no source; only newly added suites need a
    // bootstrap check, while the changed diff detects unsafe shortcuts.
    const source = readSource(file);
    if (/process\.env\.DATABASE_URL\s*\?\s*createDatabase\(\s*process\.env\s*\)/.test(source)) {
      issues.push('Mutating integration tests cannot connect from unchecked DATABASE_URL.');
    }
    if (!addedIntegrationSuites.has(file)) continue;
    const connectionAt = source.search(
      /\bcreateDatabase\s*\(\s*process\.env\s*\)|\bnew\s+(?:(?:pg)\.)?(?:Pool|Client)\s*\(/,
    );
    if (connectionAt < 0) continue;
    const guardAt = source.search(
      /\bassert\w*DisposableDatabase\s*\(\s*process\.env\s*\)/,
    );
    if (guardAt < 0 || guardAt > connectionAt) {
      issues.push(
        'New PostgreSQL integration suites require a fail-closed disposable DB guard before connecting.',
      );
    }
  }
  if (files.includes('apps/api/src/migration/meiping-review-service.ts')) {
    const service = readSource('apps/api/src/migration/meiping-review-service.ts');
    if (
      /\.insert\(\s*meipingReview(?:Decision|Correction)History\s*\)[\s\S]{0,650}?\.onConflictDoNothing\s*\(/.test(
        service,
      )
    ) {
      issues.push('Immutable review history must never silently ignore version-key collisions.');
    }
  }
  return [...new Set(issues)];
}

export function runReviewGate(base, eventPath) {
  if (!/^[0-9a-f]{40}$/i.test(base ?? '')) throw new Error('Missing PR base commit SHA');
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  if (!event.pull_request) throw new Error('pull_request context required');
  const range = base + '...HEAD';
  const files = execFileSync('git', ['diff', '--name-only', range, '--'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
  const patch = execFileSync('git', ['diff', '--unified=0', range, '--'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return reviewIssues({
    files,
    patch,
    body: event.pull_request.body ?? '',
    readSource: (path) => readFileSync(path, 'utf8'),
  });
}

if (process.argv[1]?.endsWith('check-pr-review-gates.mjs')) {
  try {
    const issues = runReviewGate(process.env.BASE_SHA, process.env.GITHUB_EVENT_PATH);
    for (const issue of issues) process.stderr.write('::error::PR review gate: ' + issue + '\n');
    if (issues.length) process.exitCode = 1;
    else console.log('PASS: PR review scope, migration and error-safety gate.');
  } catch (error) {
    process.stderr.write('::error::PR review gate failed: ' + String(error) + '\n');
    process.exitCode = 1;
  }
}
