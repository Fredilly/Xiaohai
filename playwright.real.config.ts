import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'staff-real-smoke.spec.ts',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  use: {
    serviceWorkers: 'block',
    baseURL: 'http://127.0.0.1:4187',
  },
});
