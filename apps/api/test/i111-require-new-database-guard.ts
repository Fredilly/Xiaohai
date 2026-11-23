import { isIP } from 'node:net';

const STOP = 'I111_REQUIRE_NEW_DATABASE_GUARD_STOP';
const TEST_ROLE = 'xiaohai_i111_require_new_test';
const DENIED_HOST_PORTS = new Set([5432, 52511, 55000]);
const activationKeys = [
  'I111_REQUIRE_NEW_PG_TEST',
  'I111_REQUIRE_NEW_TEST_RUN_ID',
  'I111_REQUIRE_NEW_EXPECTED_DATABASE_OID',
  'I111_REQUIRE_NEW_EXPECTED_SYSTEM_IDENTIFIER',
  'I111_REQUIRE_NEW_EXPECTED_SERVER_ADDRESS',
  'I111_REQUIRE_NEW_EXPECTED_SERVER_PORT',
  'I111_REQUIRE_NEW_EXPECTED_SERVER_VERSION',
] as const;

type GuardEnv = Partial<
  Pick<
    NodeJS.ProcessEnv,
    'APP_ENV' | 'DATABASE_URL' | 'NODE_ENV' | 'TEST_DATABASE_URL' | (typeof activationKeys)[number]
  >
>;

export type I111RequireNewDatabaseConfig = Readonly<{
  databaseName: string;
  databaseComment: string;
  expectedDatabaseOid: number;
  expectedServerAddress: string;
  expectedServerPort: number;
  expectedServerVersion: string;
  expectedSystemIdentifier: string;
  runId: string;
}>;

function stop(): never {
  throw new Error(STOP);
}

function requiredInteger(value: string | undefined, minimum: number, maximum: number): number {
  if (!value || !/^\d+$/u.test(value)) stop();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) stop();
  return parsed;
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    stop();
  }
}

/**
 * Returns null only when the dedicated suite is entirely unconfigured.
 * Any partial opt-in or ambiguous target fails before createDatabase().
 */
export function readI111RequireNewDatabaseConfig(
  env: GuardEnv,
): I111RequireNewDatabaseConfig | null {
  const configured = activationKeys.some((key) => env[key] !== undefined);
  if (!configured) return null;
  if (
    env.I111_REQUIRE_NEW_PG_TEST !== '1' ||
    env.NODE_ENV !== 'test' ||
    env.APP_ENV !== 'dev' ||
    !env.DATABASE_URL ||
    !env.TEST_DATABASE_URL ||
    env.DATABASE_URL !== env.TEST_DATABASE_URL
  ) {
    stop();
  }

  const runId = env.I111_REQUIRE_NEW_TEST_RUN_ID;
  if (!runId || !/^[a-z0-9]{12,32}$/u.test(runId)) stop();

  let url: URL;
  try {
    url = new URL(env.TEST_DATABASE_URL);
  } catch {
    stop();
  }
  const databaseName = `xiaohai_i111_require_new_${runId}`;
  const hostPort = requiredInteger(url.port, 1024, 65535);
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    DENIED_HOST_PORTS.has(hostPort) ||
    decoded(url.username) !== TEST_ROLE ||
    !url.password ||
    decoded(url.pathname.slice(1)) !== databaseName ||
    Boolean(url.search) ||
    Boolean(url.hash)
  ) {
    stop();
  }

  const expectedDatabaseOid = requiredInteger(
    env.I111_REQUIRE_NEW_EXPECTED_DATABASE_OID,
    16_384,
    2_147_483_647,
  );
  const expectedServerPort = requiredInteger(env.I111_REQUIRE_NEW_EXPECTED_SERVER_PORT, 1, 65_535);
  const expectedServerAddress = env.I111_REQUIRE_NEW_EXPECTED_SERVER_ADDRESS;
  const expectedSystemIdentifier = env.I111_REQUIRE_NEW_EXPECTED_SYSTEM_IDENTIFIER;
  const expectedServerVersion = env.I111_REQUIRE_NEW_EXPECTED_SERVER_VERSION;
  if (
    !expectedServerAddress ||
    isIP(expectedServerAddress) === 0 ||
    !expectedSystemIdentifier ||
    !/^\d{10,24}$/u.test(expectedSystemIdentifier) ||
    !expectedServerVersion ||
    !/^17\.\d+$/u.test(expectedServerVersion)
  ) {
    stop();
  }

  return Object.freeze({
    databaseName,
    databaseComment: `xiaohai-i111-require-new-disposable:${runId}`,
    expectedDatabaseOid,
    expectedServerAddress,
    expectedServerPort,
    expectedServerVersion,
    expectedSystemIdentifier,
    runId,
  });
}
