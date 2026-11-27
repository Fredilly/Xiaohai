import { expect, test } from '@playwright/test';

const storeUrl = process.env.REAL_E2E_STORE_URL;
const adminUrl = process.env.REAL_E2E_ADMIN_URL;
const storeLogin = process.env.REAL_E2E_STORE_LOGIN;
const storePassword = process.env.REAL_E2E_STORE_PASSWORD;
const adminLogin = process.env.REAL_E2E_ADMIN_LOGIN;
const adminPassword = process.env.REAL_E2E_ADMIN_PASSWORD;

function requireLocalUrl(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for real staff E2E`);
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error(`${name} must target a local disposable environment`);
  }
  return url.toString();
}

test('Store and HQ login use the real API and persisted staff session', async ({ page }) => {
  const store = requireLocalUrl(storeUrl, 'REAL_E2E_STORE_URL');
  const admin = requireLocalUrl(adminUrl, 'REAL_E2E_ADMIN_URL');
  if (!storeLogin || !storePassword || !adminLogin || !adminPassword) {
    throw new Error('Real staff E2E credentials are required through process environment');
  }

  for (const [baseUrl, login, password, heading, button] of [
    [store, storeLogin, storePassword, '胖竹书店门店工作台', '进入工作台'],
    [admin, adminLogin, adminPassword, '总部运营后台', '登录后台'],
  ] as const) {
    const apiResponses: number[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/api/')) apiResponses.push(response.status());
    });
    await page.goto(baseUrl);
    await page.getByLabel('登录账号').fill(login);
    await page.getByLabel('密码').fill(password);
    await page.getByRole('button', { name: button }).click();
    await expect(page.getByLabel('登录账号')).toBeHidden();
    await expect(page.locator('body')).toContainText(heading);
    await expect.poll(() => apiResponses.length).toBeGreaterThan(0);
    expect(apiResponses.every((status) => status >= 200 && status < 300)).toBe(true);
    expect(await page.evaluate(() => Boolean(sessionStorage.getItem('staff_session_token')))).toBe(
      true,
    );
    await page.goto(baseUrl);
  }
});
