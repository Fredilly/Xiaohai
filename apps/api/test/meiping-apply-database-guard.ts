/**
 * Fail closed BEFORE createDatabase() or any mutating Meiping apply fixture.
 *
 * createDatabase() uses TEST_DATABASE_URL (not DATABASE_URL) when NODE_ENV=test,
 * so checking only DATABASE_URL could otherwise validate the wrong target.
 */
type DatabaseTestEnv = Pick<
  NodeJS.ProcessEnv,
  'DATABASE_URL' | 'TEST_DATABASE_URL' | 'NODE_ENV' | 'APP_ENV'
>;

const DISPOSABLE_DATABASES = new Set(['xiaohai_test', 'xiaohai_pr162_security_test']);
const LOCAL_DATABASE_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const UNSAFE_TARGET =
  'Meiping apply integration requires a local allowlisted disposable test database';

function assertAllowedUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(UNSAFE_TARGET);
  }

  if (
    (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') ||
    !LOCAL_DATABASE_HOSTS.has(url.hostname) ||
    !DISPOSABLE_DATABASES.has(url.pathname.slice(1)) ||
    Boolean(url.search) ||
    Boolean(url.hash)
  ) {
    throw new Error(UNSAFE_TARGET);
  }
  return url;
}

/** False only when unconfigured; any configured unsafe target throws. */
export function assertMeipingApplyDisposableDatabase(env: DatabaseTestEnv): boolean {
  if (!env.DATABASE_URL) return false;
  if (
    env.NODE_ENV === 'production' ||
    (env.APP_ENV !== undefined && env.APP_ENV !== 'dev' && env.APP_ENV !== 'test')
  ) {
    throw new Error(UNSAFE_TARGET);
  }

  const databaseUrl = assertAllowedUrl(env.DATABASE_URL);
  if (env.NODE_ENV === 'test' && !env.TEST_DATABASE_URL) {
    throw new Error(UNSAFE_TARGET);
  }
  if (env.TEST_DATABASE_URL) {
    const testDatabaseUrl = assertAllowedUrl(env.TEST_DATABASE_URL);
    if (databaseUrl.href !== testDatabaseUrl.href) {
      throw new Error(UNSAFE_TARGET);
    }
  }
  return true;
}
