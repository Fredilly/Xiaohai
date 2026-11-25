import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { validateProductionWebSource } from './production-web-preflight.mjs';

// Configuration-only check. Boolean attestations need actual operator evidence;
// this script cannot observe ECS capacity, Docker networks or usable backups.
export function validateProductionCohostEnvironment(env) {
  const failures = [];
  const revision = /^[0-9a-f]{40}$/u;
  if (!revision.test(env.WEB_REVISION ?? '') || !revision.test(env.API_REVISION ?? '')) {
    failures.push('WEB_REVISION and API_REVISION must be exact reviewed 40-character SHAs');
  }
  if (env.WEB_REVISION !== env.API_REVISION) {
    failures.push('Production web and backend must use the same source revision');
  }
  for (const flag of [
    'COHOST_ARCHITECTURE_APPROVED',
    'COHOST_INGRESS_EVIDENCE_VERIFIED',
    'COHOST_CAPACITY_EVIDENCE_VERIFIED',
    'PRODUCTION_BACKUP_RESTORE_VERIFIED',
  ]) {
    if (env[flag] !== 'true')
      failures.push(`${flag}=true requires independently documented evidence`);
  }
  if (env.APP_ENV !== 'production' || env.NODE_ENV !== 'production') {
    failures.push('Production processes must use APP_ENV=production and NODE_ENV=production');
  }
  if (!env.POSTGRES_DB || /staging|test|dev/iu.test(env.POSTGRES_DB)) {
    failures.push('POSTGRES_DB must identify a dedicated, non-staging production database');
  }
  if (!env.POSTGRES_USER || /staging|test|dev/iu.test(env.POSTGRES_USER)) {
    failures.push('POSTGRES_USER must be a dedicated production database user');
  }
  if (typeof env.POSTGRES_PASSWORD !== 'string' || env.POSTGRES_PASSWORD.length < 32) {
    failures.push('POSTGRES_PASSWORD must be a distinct strong production secret');
  }
  try {
    const db = new URL(env.DATABASE_URL ?? '');
    if (
      !['postgres:', 'postgresql:'].includes(db.protocol) ||
      db.hostname !== 'postgres' ||
      (db.port && db.port !== '5432') ||
      decodeURIComponent(db.username) !== env.POSTGRES_USER ||
      decodeURIComponent(db.password) !== env.POSTGRES_PASSWORD ||
      decodeURIComponent(db.pathname.slice(1)) !== env.POSTGRES_DB ||
      db.search ||
      db.hash
    ) {
      failures.push(
        'DATABASE_URL must target only this Compose project postgres service and credentials',
      );
    }
  } catch {
    failures.push('DATABASE_URL must be a valid production PostgreSQL URL');
  }
  if (env.REDIS_URL !== 'redis://redis:6379') {
    failures.push('REDIS_URL must target only this Compose project redis service');
  }
  for (const flag of ['WECHAT_PAY_ENABLED', 'FOOD_STOCK_WRITES_ENABLED', 'FOOD_CHECKOUT_ENABLED']) {
    if (env[flag] !== 'false') failures.push(`${flag} must remain false until independent UAT`);
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = validateProductionCohostEnvironment(process.env);
  if (!failures.length) {
    try {
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
      failures.push(...validateProductionWebSource(process.env, head, status));
    } catch {
      failures.push('Production packaging requires a readable Git checkout');
    }
  }
  for (const failure of failures) console.error(`Production cohost preflight: ${failure}.`);
  if (failures.length) process.exitCode = 1;
  else {
    console.log(
      'Production cohost SOURCE/ENV preflight PASS; live ECS, network, backups, DNS, TLS, DB migrations and UAT remain UNVERIFIED.',
    );
  }
}
