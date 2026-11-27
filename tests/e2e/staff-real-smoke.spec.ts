import { expect, test } from '@playwright/test';

const storeUrl = process.env.REAL_E2E_STORE_URL;
const adminUrl = process.env.REAL_E2E_ADMIN_URL;
const storeLogin = process.env.REAL_E2E_STORE_LOGIN;
const storePassword = process.env.REAL_E2E_STORE_PASSWORD;
const adminLogin = process.env.REAL_E2E_ADMIN_LOGIN;
const adminPassword = process.env.REAL_E2E_ADMIN_PASSWORD;
const storeId = process.env.REAL_E2E_STORE_ID;
const otherStoreId = process.env.REAL_E2E_OTHER_STORE_ID;

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
  if (!storeId || !otherStoreId) throw new Error('Real E2E store scope IDs are required');

  async function api(path: string, init?: RequestInit) {
    return page.evaluate(
      async ({ path, init }) => {
        const token = sessionStorage.getItem('staff_session_token');
        const response = await fetch(path, {
          ...init,
          headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token ?? ''}` },
        });
        return { status: response.status, body: await response.json().catch(() => null) };
      },
      { path, init },
    );
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
    const me = await api('/api/v1/staff/me');
    expect(me.status).toBe(200);
    await page.goto(baseUrl);
  }

  // Store staff is restricted by the server-side data scope. These requests
  // are real browser fetches through Vite to Fastify and PostgreSQL; no route
  // interception or synthetic response is used.
  await page.goto(store);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByLabel('登录账号').fill(storeLogin);
  await page.getByLabel('密码').fill(storePassword);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByLabel('登录账号')).toBeHidden();
  expect((await api(`/api/v1/staff/inventory?storeId=${storeId}`)).status).toBe(200);
  expect((await api(`/api/v1/staff/inventory?storeId=${otherStoreId}`)).status).toBe(403);
  expect((await api(`/api/v1/staff/stores/${storeId}/catalog`)).status).toBe(200);

  // HQ scope can read both stores and can create a disposable supplier record;
  // this is the smallest real write proving browser -> API -> PostgreSQL.
  await page.goto(admin);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByLabel('登录账号').fill(adminLogin);
  await page.getByLabel('密码').fill(adminPassword);
  await page.getByRole('button', { name: '登录后台' }).click();
  await expect(page.getByLabel('登录账号')).toBeHidden();
  expect((await api(`/api/v1/staff/inventory?storeId=${otherStoreId}`)).status).toBe(200);
  const supplier = await api('/api/v1/staff/inventory/suppliers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: `E2E-${Date.now()}`, name: 'Disposable E2E Supplier' }),
  });
  expect(supplier.status).toBe(201);
  const suppliers = await api('/api/v1/staff/inventory/suppliers');
  expect(suppliers.status).toBe(200);
  expect(
    suppliers.body.suppliers?.some(
      (item: { name?: string }) => item.name === 'Disposable E2E Supplier',
    ),
  ).toBe(true);
});
