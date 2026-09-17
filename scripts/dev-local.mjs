import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import net from 'node:net';
import process from 'node:process';

const root = process.cwd();
const envPath = `${root}/.env`;
const envExamplePath = `${root}/.env.example`;

function isPortOpen(port, host = '127.0.0.1', timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForPort(port, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await isPortOpen(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

if (!existsSync(envPath)) {
  if (!existsSync(envExamplePath)) {
    console.error('Missing both .env and .env.example.');
    process.exit(1);
  }
  copyFileSync(envExamplePath, envPath);
  console.log(
    'Created .env from .env.example. Fill in any local secrets you need.',
  );
}

if (!(await isPortOpen(5432))) {
  if (
    process.platform === 'darwin' &&
    existsSync('/Applications/Postgres.app')
  ) {
    console.log('PostgreSQL is not running. Starting Postgres.app...');
    const result = spawnSync('open', ['/Applications/Postgres.app'], {
      stdio: 'inherit',
    });
    if (result.status !== 0 || !(await waitForPort(5432))) {
      console.error('Postgres.app did not become ready on 127.0.0.1:5432.');
      process.exit(1);
    }
  } else {
    console.error(
      'PostgreSQL is not reachable on 127.0.0.1:5432. Start your local PostgreSQL server, then retry.',
    );
    process.exit(1);
  }
}

console.log('PostgreSQL is ready. Applying migrations...');
const migration = spawnSync(
  'pnpm',
  ['--filter', '@xiaohai/db', 'db:migrate'],
  {
    cwd: root,
    stdio: 'inherit',
  },
);
if (migration.status !== 0) process.exit(migration.status ?? 1);

if (!(await isPortOpen(6379))) {
  console.warn(
    'Redis is not running on 127.0.0.1:6379. Home/CMS can still run, but Redis-backed features may be unavailable.',
  );
}

console.log('Starting Xiaohai API on http://127.0.0.1:3000 ...');
const api = spawn('pnpm', ['--filter', '@xiaohai/api', 'dev'], {
  cwd: root,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => api.kill(signal));
}

api.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
