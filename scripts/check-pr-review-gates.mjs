#!/usr/bin/env node
// Pre-human-review gate. The PR diff is authoritative, not an old PR title.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function reviewIssues({ files, patch = '', body = '', readSource = () => '' }) {
  const issues = [];
  const has = (pattern) => files.some((file) => pattern.test(file));
  const migration = has(/^packages\/db\/migrations\/\d{4}_[^/]+\.sql$/);
  const hq = has(/^apps\/admin-web\/src\/catalog[-\w]*\.(?:ts|tsx)$/) ||
    has(/^apps\/api\/src\/commerce\/commerce-(?:service|routes)\.ts$/);
  const meiping = has(/^apps\/(?:api|admin-web|store-web)\/src\/migration\/meiping/) ||
    has(/^apps\/(?:api|admin-web|store-web)\/src\/meiping/);

  if (hq && meiping) issues.push('Unrelated HQ catalog and Meiping changes must be separated.');
  if (migration) {
    if (!has(/^docs\/[\w.-]*(?:MIGRATION|RUNBOOK|migration|runbook)[\w.-]*\.md$/)) {
      issues.push('New SQL migration requires a dedicated changed migration/runbook document.');
    }
    if (!/migration|迁移/i.test(body) || !/rollback|恢复|回滚/i.test(body) ||
        !/reconcil|核对|对账|校验/i.test(body)) {
      issues.push('Migration PR body must describe migration, rollback and reconciliation.');
    }
    if (hq) issues.push('Do not mix HQ catalog work with SQL migration.');
  }
  if (hq && /(?:\bno\b|\bwithout\b|不涉及|不包含|不修改)[^\n.。]{0,55}(?:HQ|总部|Admin\s*Web)/i.test(body)) {
    issues.push('PR description denies HQ changes but the diff contains them.');
  }
  if (migration && /(?:\bno\b|\bwithout\b|不涉及|不包含|不修改)[^\n.。]{0,40}(?:migration|SQL|数据库迁移)/i.test(body)) {
    issues.push('PR description denies migration but the diff contains SQL migration.');
  }
  if (body.trim().length < 120 || !/test|CI|测试|验证/i.test(body)) {
    issues.push('Describe actual scope, risks and testing in the PR body.');
  }
  for (const line of patch.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    if (/\bmessage\s*:\s*(?:(?:err|error)\??\.message\b|(?:err|error)\s+instanceof\b)/.test(line.slice(1))) {
      issues.push('Raw exception text may be exposed in an HTTP response; use allowlisted messages.');
      break;
    }
  }
  if (files.includes('apps/api/src/migration/meiping-review-service.ts')) {
    const service = readSource('apps/api/src/migration/meiping-review-service.ts');
    if (/\.insert\(\s*meipingReview(?:Decision|Correction)History\s*\)[\s\S]{0,650}?\.onConflictDoNothing\s*\(/.test(service)) {
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
    .trim().split('\n').filter(Boolean);
  const patch = execFileSync('git', ['diff', '--unified=0', range, '--'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return reviewIssues({
    files, patch, body: event.pull_request.body ?? '',
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
