import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Inventory fixtures and the real Staff/API/PostgreSQL flow have dedicated runners.
  // The default CI smoke suite must not silently require their browser/runtime setup.
  testIgnore: ['inventory-operations.spec.ts', 'staff-real-smoke.spec.ts'],
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'on-first-retry' },
});
