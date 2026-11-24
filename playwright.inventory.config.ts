import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'inventory-operations.spec.ts',
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4187',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: 'pnpm --filter @xiaohai/store-web exec vite --host 127.0.0.1 --port 4187 --strictPort',
    url: 'http://127.0.0.1:4187/test/inventory.html',
    reuseExistingServer: false,
    env: { VITE_API_BASE_URL: '' },
  },
});
