import { describe, expect, it } from 'vitest';
import { loadDatabaseConfig, loadServiceConfig } from '../src/index.js';

describe('environment isolation foundation', () => {
  it('rejects unknown environments', () =>
    expect(() => loadServiceConfig({ APP_ENV: 'preview' })).toThrow());
  it('requires a PostgreSQL URL', () =>
    expect(() => loadDatabaseConfig({ APP_ENV: 'dev', DATABASE_URL: 'sqlite://local' })).toThrow());
});
