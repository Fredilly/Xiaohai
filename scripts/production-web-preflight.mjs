import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const WEB_HOSTS = new Set(['store.pamboo.asia', 'admin.pamboo.asia']);

/** Pure local validation. This never connects to or changes remote infrastructure. */
export function validateProductionWebEnvironment(env) {
  const failures = [];
  if (!/^[0-9a-f]{40}$/u.test(env.WEB_REVISION ?? '')) {
    failures.push('WEB_REVISION must pin an exact 40-character commit SHA');
  }

  let upstream;
  try {
    upstream = new URL(env.PRODUCTION_API_UPSTREAM ?? '');
  } catch {
    failures.push('PRODUCTION_API_UPSTREAM must be an absolute HTTPS URL');
    return failures;
  }
  if (
    upstream.protocol !== 'https:' ||
    upstream.port ||
    upstream.pathname !== '/' ||
    upstream.search ||
    upstream.hash
  ) {
    failures.push(
      'PRODUCTION_API_UPSTREAM must be an HTTPS origin without ports, paths or parameters',
    );
  }
  if (upstream.username || upstream.password) {
    failures.push('PRODUCTION_API_UPSTREAM must not contain credentials');
  }
  const host = upstream.hostname.replace(/\.$/u, '').toLowerCase();
  if (
    WEB_HOSTS.has(host) ||
    host === 'pamboo.asia' ||
    host === 'staging-api.pamboo.asia' ||
    host.startsWith('staging-') ||
    host.endsWith('.invalid') ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]'
  ) {
    failures.push(
      'PRODUCTION_API_UPSTREAM must be a separate approved production API, not staging, a website host or a placeholder',
    );
  }
  return failures;
}

export function validateProductionWebSource(env, head, porcelainStatus) {
  const failures = [];
  if (head !== env.WEB_REVISION) failures.push('WEB_REVISION must equal the checked-out HEAD');
  if (porcelainStatus.trim())
    failures.push('Build source tree must be clean before production packaging');
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = validateProductionWebEnvironment(process.env);
  if (failures.length === 0) {
    try {
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
      failures.push(...validateProductionWebSource(process.env, head, status));
    } catch {
      failures.push('Production packaging requires a readable Git checkout');
    }
  }
  for (const failure of failures) console.error(`Production web preflight: ${failure}.`);
  if (failures.length) process.exitCode = 1;
  else
    console.log(
      'Production web local configuration preflight PASS; DNS, TLS, server and API readiness are NOT tested.',
    );
}
