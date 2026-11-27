import process from 'node:process';
import { pathToFileURL } from 'node:url';

// Configuration-only gate. Assertions below cannot prove live ECS capacity,
// cloud snapshot recoverability, DNS/TLS or an operator-approved maintenance
// window. Those need independent evidence before any host-side action.
export function validateProductionCutoverEnvironment(env) {
  const failures = [];
  const sha = /^[0-9a-f]{40}$/u;
  const digest = /^sha256:[0-9a-f]{64}$/u;
  if (!sha.test(env.API_REVISION ?? '') || env.API_REVISION !== env.WEB_REVISION) {
    failures.push('API_REVISION and WEB_REVISION must pin the same reviewed source SHA');
  }
  for (const key of ['API_IMAGE_DIGEST', 'WORKER_IMAGE_DIGEST', 'WEB_IMAGE_DIGEST']) {
    if (!digest.test(env[key] ?? '')) failures.push(`${key} must be an immutable SHA-256 digest`);
  }
  for (const key of [
    'CUTOVER_FINAL_APPROVED',
    'CUTOVER_STAGING_STOP_APPROVED',
    'CUTOVER_CAPACITY_EVIDENCE_VERIFIED',
    'CUTOVER_BACKUP_RESTORE_VERIFIED',
    'CUTOVER_ROLLBACK_EVIDENCE_VERIFIED',
    'CUTOVER_INGRESS_EVIDENCE_VERIFIED',
  ]) {
    if (env[key] !== 'true') failures.push(`${key}=true requires independent operator evidence`);
  }
  if (env.APP_ENV !== 'production' || env.NODE_ENV !== 'production') {
    failures.push('Production APP_ENV and NODE_ENV are required');
  }
  if (!env.POSTGRES_DB || /staging|test|dev/iu.test(env.POSTGRES_DB)) {
    failures.push('Dedicated production POSTGRES_DB required');
  }
  if (!env.POSTGRES_USER || /staging|test|dev/iu.test(env.POSTGRES_USER)) {
    failures.push('Dedicated production POSTGRES_USER required');
  }
  if (!env.POSTGRES_PASSWORD || env.POSTGRES_PASSWORD.length < 32) {
    failures.push('Distinct 32+ character production database password required');
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
    )
      failures.push('DATABASE_URL must resolve to the isolated Compose postgres service');
  } catch {
    failures.push('Valid isolated production DATABASE_URL required');
  }
  if (env.REDIS_URL !== 'redis://redis:6379') {
    failures.push('REDIS_URL must resolve to the isolated Compose redis service');
  }
  if (!/^wx[0-9a-f]{16}$/u.test(env.WECHAT_APP_ID ?? '')) {
    failures.push('Verified production WeChat AppID required');
  }
  if (!env.WECHAT_APP_SECRET || /replace|placeholder|test|staging/iu.test(env.WECHAT_APP_SECRET)) {
    failures.push('Production WeChat AppSecret required from trusted operator source');
  }
  for (const key of ['CONSUMER_SESSION_SECRET', 'STAFF_SESSION_SECRET', 'PICKUP_CODE_SECRET']) {
    if (!env[key] || env[key].length < 32 || /replace|placeholder/iu.test(env[key])) {
      failures.push(`${key} requires a distinct production-only 32+ character secret`);
    }
  }
  if (
    new Set([
      env.CONSUMER_SESSION_SECRET,
      env.STAFF_SESSION_SECRET,
      env.PICKUP_CODE_SECRET,
      env.POSTGRES_PASSWORD,
    ]).size !== 4
  )
    failures.push('Production service secrets must not be reused');
  for (const key of ['WECHAT_PAY_ENABLED', 'FOOD_STOCK_WRITES_ENABLED', 'FOOD_CHECKOUT_ENABLED']) {
    if (env[key] !== 'false') failures.push(`${key} must remain false for limited launch`);
  }
  for (const key of [
    'STORY_AI_ENABLED',
    'PICTURE_BOOK_AI_ENABLED',
    'PICTURE_BOOK_IMAGE_ENABLED',
    'ANIMATION_AI_ENABLED',
    'ANIMATION_VIDEO_ENABLED',
    'ANIMATION_COMPOSITION_ENABLED',
  ]) {
    if (env[key] !== 'false') failures.push(`${key} must remain false for limited launch`);
  }
  if (env.AI_MOCK_ENABLED !== 'false') {
    failures.push('AI_MOCK_ENABLED must remain false in production');
  }
  for (const key of ['POSTGRES', 'REDIS', 'API', 'WORKER', 'WEB', 'EDGE']) {
    if (!/^[1-9][0-9]*(?:m|g)$/u.test(env[`PRODUCTION_${key}_MEM_LIMIT`] ?? '')) {
      failures.push(`PRODUCTION_${key}_MEM_LIMIT needs a measured, explicit cap`);
    }
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = validateProductionCutoverEnvironment(process.env);
  for (const failure of failures) console.error(`Production cutover preflight: ${failure}.`);
  if (failures.length) process.exitCode = 1;
  else
    console.log(
      'Production cutover CONFIG PASS only; live host gates remain independently required.',
    );
}
