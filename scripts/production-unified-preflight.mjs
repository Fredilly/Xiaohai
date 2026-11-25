import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { validateProductionWebSource } from './production-web-preflight.mjs';

/** One reviewed revision is used for the site bundle and both API images. */
export function validateUnifiedProductionEnvironment(env) {
  const failures = [];
  if (env.PRODUCTION_HOST_ISOLATED !== 'true') {
    failures.push(
      'Unified production requires a dedicated host; existing staging Caddy already owns 80/443',
    );
  }
  if (!/^[0-9a-f]{40}$/u.test(env.WEB_REVISION ?? '')) {
    failures.push('WEB_REVISION must pin an exact reviewed commit');
  }
  if (!/^[0-9a-f]{40}$/u.test(env.API_REVISION ?? '')) {
    failures.push('API_REVISION must pin an exact reviewed commit');
  }
  if (env.API_REVISION !== env.WEB_REVISION) {
    failures.push('Unified production API and web must use one consistent source revision');
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = validateUnifiedProductionEnvironment(process.env);
  if (failures.length === 0) {
    try {
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
      failures.push(...validateProductionWebSource(process.env, head, status));
    } catch {
      failures.push('Unified production packaging requires a readable Git checkout');
    }
  }
  for (const failure of failures) console.error(`Production unified preflight: ${failure}.`);
  if (failures.length) process.exitCode = 1;
  else
    console.log(
      'Unified production source/config preflight PASS; no DNS, API, registry, TLS or deployment verification performed.',
    );
}
