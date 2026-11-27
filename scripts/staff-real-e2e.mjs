#!/usr/bin/env node
/**
 * Disposable real staff E2E runner.
 *
 * Creates uniquely named PostgreSQL/Redis containers, migrates an empty
 * database, seeds only synthetic staff/store data, starts the real API and
 * both Vite applications, runs staff-real-smoke.spec.ts, and removes every
 * resource created by this invocation. No shared project, volume, network,
 * credential file, or production endpoint is used.
 */
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import net from 'node:net';

const root = process.cwd();
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const pgName = `xiaohai-real-e2e-pg-${runId}`;
const redisName = `xiaohai-real-e2e-redis-${runId}`;
const pgPort = 43000 + Number.parseInt(runId.slice(0, 4), 16) % 1000;
const redisPort = pgPort + 1;
const storePort = pgPort + 2;
const adminPort = pgPort + 3;
const dbPassword = `e2e-${randomUUID()}`;
const hqPassword = `Hq-${randomUUID()}-pass`;
const storePassword = `Store-${randomUUID()}-pass`;
const databaseUrl = `postgresql://e2e_user:${encodeURIComponent(dbPassword)}@127.0.0.1:${pgPort}/xiaohai_e2e`;
const redisUrl = `redis://127.0.0.1:${redisPort}`;
const children = [];
let cleaned = false;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    stdio: options.stdio ?? 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status ?? 'unknown'}`);
  }
  return result.stdout?.trim() ?? '';
}

function spawnProcess(command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(child);
  return child;
}

function isOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(300);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForPort(port, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    if (await isOpen(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`port ${port} did not become ready`);
}

function docker(args) {
  return run('docker', args);
}

function startContainers() {
  // Explicitly reject collisions before creating anything.
  for (const name of [pgName, redisName]) {
    const exists = spawnSync('docker', ['container', 'inspect', name], { stdio: 'ignore' }).status === 0;
    if (exists) throw new Error(`refusing to reuse existing container ${name}`);
  }
  docker([
    'run', '-d', '--name', pgName,
    '--tmpfs', '/var/lib/postgresql/data:rw,size=1g',
    '-e', 'POSTGRES_USER=e2e_user', '-e', `POSTGRES_PASSWORD=${dbPassword}`,
    '-e', 'POSTGRES_DB=xiaohai_e2e', '-p', `127.0.0.1:${pgPort}:5432`, 'postgres:17-alpine',
  ]);
  docker([
    'run', '-d', '--name', redisName,
    '--tmpfs', '/data:rw,size=256m',
    '-p', `127.0.0.1:${redisPort}:6379`, 'redis:7.4-alpine',
  ]);
}

function seedStore() {
  const region = randomUUID();
  const store = randomUUID();
  const sql = `INSERT INTO regions (id, code, name, country_code, country_name) VALUES ('${region}', 'E2E-${runId}', 'Disposable E2E Region', 'CN', 'China'); INSERT INTO stores (id, code, region_id, name, country_code, country_name, city, timezone, address_line, latitude, longitude) VALUES ('${store}', 'E2E-${runId}', '${region}', '胖竹书店南门店', 'CN', 'China', '成都', 'Asia/Shanghai', 'Synthetic E2E address', 30.67, 104.06);`;
  docker(['exec', pgName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'e2e_user', '-d', 'xiaohai_e2e', '-c', sql]);
}

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const child of children) {
    if (!child.killed) child.kill('SIGKILL');
  }
  for (const name of [pgName, redisName]) {
    spawnSync('docker', ['rm', '-f', name], { cwd: root, stdio: 'ignore' });
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await cleanup();
    process.exit(128 + (signal === 'SIGINT' ? 2 : 15));
  });
}

try {
  if (process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production') {
    throw new Error('real staff E2E refuses production environment');
  }
  if (await isOpen(3000)) throw new Error('refusing to reuse an existing API on port 3000');
  startContainers();
  await waitForPort(pgPort);
  await waitForPort(redisPort);
  const env = {
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    APP_ENV: 'dev', NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '3000',
    WECHAT_APP_ID: 'synthetic-e2e-app', WECHAT_APP_SECRET: 'synthetic-e2e-secret',
    CONSUMER_SESSION_SECRET: `consumer-${randomUUID()}-secret`,
    STAFF_SESSION_SECRET: `staff-${randomUUID()}-secret`,
    PICKUP_CODE_SECRET: `pickup-${randomUUID()}-secret`,
    DELIVERY_PROVIDER: 'MANUAL',
    STORY_AI_PROVIDER: 'MOCK', STORY_AI_ENABLED: 'false',
    PICTURE_BOOK_AI_PROVIDER: 'MOCK', PICTURE_BOOK_AI_ENABLED: 'false',
    ANIMATION_AI_PROVIDER: 'MOCK', ANIMATION_AI_ENABLED: 'false',
    ANIMATION_VIDEO_PROVIDER: 'MOCK', ANIMATION_COMPOSITION_PROVIDER: 'MOCK',
    AI_PROVIDER: 'MOCK', AI_MOCK_ENABLED: 'true',
    FOOD_CHECKOUT_ENABLED: 'false', FOOD_STOCK_WRITES_ENABLED: 'false',
  };
  run('node', ['--conditions=development', '--import', 'tsx/esm', 'packages/db/src/migrate.ts'], { env });
  seedStore();
  run('node', ['--conditions=development', '--import', 'tsx/esm', 'apps/api/src/dev/seed-local-staff-cli.ts'], {
    env: { ...env, LOCAL_HQ_STAFF_PASSWORD: hqPassword, LOCAL_STORE_STAFF_PASSWORD: storePassword },
  });
  spawnProcess('node', ['--conditions=development', '--import', 'tsx/esm', 'apps/api/src/server.ts'], env);
  await waitForPort(3000);
  spawnProcess('pnpm', ['--filter', '@xiaohai/store-web', 'dev', '--', '--host', '127.0.0.1', '--port', String(storePort)], env);
  spawnProcess('pnpm', ['--filter', '@xiaohai/admin-web', 'dev', '--', '--host', '127.0.0.1', '--port', String(adminPort)], env);
  await waitForPort(storePort);
  await waitForPort(adminPort);
  run('pnpm', ['exec', 'playwright', 'test', '--config', 'playwright.real.config.ts'], {
    env: {
      ...env,
      REAL_E2E_STORE_URL: `http://127.0.0.1:${storePort}`,
      REAL_E2E_ADMIN_URL: `http://127.0.0.1:${adminPort}`,
      REAL_E2E_STORE_LOGIN: 'store.manager', REAL_E2E_STORE_PASSWORD: storePassword,
      REAL_E2E_ADMIN_LOGIN: 'hq.admin', REAL_E2E_ADMIN_PASSWORD: hqPassword,
    },
  });
  console.log('REAL_STAFF_E2E_PASS');
} finally {
  await cleanup();
}
