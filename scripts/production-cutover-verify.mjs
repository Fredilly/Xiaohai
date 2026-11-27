#!/usr/bin/env node
// Configuration-only checks: never print credentials or touch running services.
import { statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProductionCutoverEnvironment } from './production-cutover-preflight.mjs';

const deploy = resolve(dirname(fileURLToPath(import.meta.url)), '../deploy');
const envFile = resolve(deploy, 'production.env');
const composeFile = resolve(deploy, 'production-cutover.compose.yml');
const caddyFile = resolve(deploy, 'Caddyfile.production-cutover');

export function checkCommands({ run, mode, flags }) {
  if (mode !== 0o600) return ['production.env must have owner-only permissions (0600)'];
  if (flags.length) return flags;
  if (
    run('docker', ['compose', '--env-file', envFile, '-f', composeFile, 'config', '--quiet']) !== 0
  )
    return ['Docker Compose config check failed (details suppressed)'];
  if (run('caddy', ['version']) === 0) {
    if (run('caddy', ['validate', '--config', caddyFile]) !== 0)
      return ['Caddy config check failed (details suppressed)'];
  } else {
    if (run('docker', ['image', 'inspect', 'caddy:2-alpine']) !== 0)
      return ['Caddy validator unavailable locally; no image was pulled'];
    if (
      run('docker', [
        'run',
        '--rm',
        '--pull',
        'never',
        '--network',
        'none',
        '--read-only',
        '--mount',
        `type=bind,source=${caddyFile},target=/etc/caddy/Caddyfile,readonly`,
        'caddy:2-alpine',
        'caddy',
        'validate',
        '--config',
        '/etc/caddy/Caddyfile',
      ]) !== 0
    )
      return ['Disposable Caddy config check failed (details suppressed)'];
  }
  return [];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = statSync(envFile).mode & 0o777;
    const flags = validateProductionCutoverEnvironment(process.env);
    const run = (cmd, args) =>
      spawnSync(cmd, args, {
        stdio: 'ignore',
        timeout: 30_000,
      }).status ?? 127;
    const failures = checkCommands({ run, mode, flags });
    if (failures.length) {
      for (const failure of failures) console.error(`CUTOVER_VERIFY_STOP: ${failure}`);
      process.exitCode = 1;
    } else {
      console.log('CUTOVER_LOCAL_CONFIG_PASS (no services changed; host approval still required)');
    }
  } catch {
    console.error('CUTOVER_VERIFY_STOP: missing/unreadable trusted production.env');
    process.exitCode = 1;
  }
}
