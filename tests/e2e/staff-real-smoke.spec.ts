import { expect, test } from '@playwright/test';

const storeUrl = process.env.REAL_E2E_STORE_URL;
const adminUrl = process.env.REAL_E2E_ADMIN_URL;
const storeLogin = process.env.REAL_E2E_STORE_LOGIN;
const storePassword = process.env.REAL_E2E_STORE_PASSWORD;
const adminLogin = process.env.REAL_E2E_ADMIN_LOGIN;
const adminPassword = process.env.REAL_E2E_ADMIN_PASSWORD;
const storeId = process.env.REAL_E2E_STORE_ID;
const otherStoreId = process.env.REAL_E2E_OTHER_STORE_ID;
const seededSkuId = process.env.REAL_E2E_SKU_ID;
const consumerSkuId = process.env.REAL_E2E_CONSUMER_SKU_ID;
const seededSupplierId = process.env.REAL_E2E_SUPPLIER_ID;
const consumerToken = process.env.REAL_E2E_CONSUMER_TOKEN;

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
  if (
    !storeId ||
    !otherStoreId ||
    !seededSkuId ||
    !consumerSkuId ||
    !seededSupplierId ||
    !consumerToken
  )
    throw new Error('Real E2E store/catalog IDs are required');

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

  async function consumerApi(path: string, init?: RequestInit) {
    return page.evaluate(
      async ({ path, init, token }) => {
        const response = await fetch(path, {
          ...init,
          headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` },
        });
        return { status: response.status, body: await response.json().catch(() => null) };
      },
      { path, init, token: consumerToken },
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

  // HQ catalog create/edit is a real browser -> Fastify -> PostgreSQL cycle.
  // The stale version request must be rejected after the committed edit.
  const suffix = Date.now();
  const createInput = {
    name: `Disposable E2E Catalog ${suffix}`,
    description: 'Synthetic browser acceptance fixture',
    status: 'ACTIVE',
    book: {
      title: `Disposable E2E Book ${suffix}`,
      author: 'Synthetic Author',
      publisher: 'Synthetic Publisher',
      isbn: null,
    },
    sku: {
      code: `E2E-CATALOG-${suffix}`,
      name: 'Standard',
      priceMinor: 1500,
      status: 'ACTIVE',
      availableForSale: true,
    },
  };
  const createdResponse = await api('/api/v1/staff/catalog/products', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `e2e-catalog-${suffix}` },
    body: JSON.stringify(createInput),
  });
  expect(createdResponse.status).toBe(201);
  const created = createdResponse.body as {
    id: string;
    skuId: string;
    productVersion: number;
    skuVersion: number;
    bookVersion: number;
    editionVersion: number;
    book: { title: string; author: string; publisher: string | null; isbn: string | null };
    sku: {
      code: string;
      name: string;
      priceMinor: number;
      status: string;
      availableForSale: boolean;
    };
  };
  const updateInput = {
    expectedProductVersion: created.productVersion,
    expectedSkuVersion: created.skuVersion,
    expectedBookVersion: created.bookVersion,
    expectedEditionVersion: created.editionVersion,
    expectedSkuId: created.skuId,
    name: `${createInput.name} revised`,
    description: createInput.description,
    status: createInput.status,
    book: { ...created.book, title: `${createInput.book.title} revised` },
    sku: { ...created.sku, priceMinor: 1600 },
  };
  const preview = await api(`/api/v1/staff/catalog/products/${created.id}/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(updateInput),
  });
  expect(preview.status).toBe(200);
  const updated = await api(`/api/v1/staff/catalog/products/${created.id}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-catalog-preview-token': preview.body.previewToken,
    },
    body: JSON.stringify(updateInput),
  });
  expect(updated.status).toBe(200);
  // A new preview with consumed versions must fail before token verification.
  // A PUT missing its token would also return 409, but prove nothing about versions.
  const stalePreview = await api(`/api/v1/staff/catalog/products/${created.id}/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(updateInput),
  });
  expect(stalePreview.status).toBe(409);
  const stale = await api(`/api/v1/staff/catalog/products/${created.id}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-catalog-preview-token': preview.body.previewToken,
    },
    body: JSON.stringify(updateInput),
  });
  expect(stale.status).toBe(409);

  // Real inventory procurement, receipt, stocktake and transfer transitions.
  const purchaseOrder = await api('/api/v1/staff/inventory/purchase-orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      supplierId: seededSupplierId,
      storeId,
      items: [{ skuId: seededSkuId, quantity: 2, unitCostMinor: 500 }],
    }),
  });
  expect(purchaseOrder.status).toBe(201);
  const purchaseOrderBody = purchaseOrder.body as { id: string; items: Array<{ id: string }> };
  expect(
    (
      await api(`/api/v1/staff/inventory/purchase-orders/${purchaseOrderBody.id}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'SUBMIT' }),
      })
    ).status,
  ).toBe(200);
  const receipt = await api('/api/v1/staff/inventory/goods-receipts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      purchaseOrderId: purchaseOrderBody.id,
      items: [{ purchaseOrderItemId: purchaseOrderBody.items[0].id, quantity: 2 }],
    }),
  });
  expect(receipt.status).toBe(201);
  expect(
    (
      await api(
        `/api/v1/staff/inventory/goods-receipts/${(receipt.body as { id: string }).id}/post`,
        {
          method: 'POST',
        },
      )
    ).status,
  ).toBe(200);
  const inventory = await api(`/api/v1/staff/inventory?storeId=${storeId}`);
  expect(inventory.status).toBe(200);

  const stocktake = await api('/api/v1/staff/inventory/stocktakes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ storeId, skuIds: [seededSkuId] }),
  });
  expect(stocktake.status).toBe(201);
  const stocktakeId = (stocktake.body as { id: string }).id;
  expect(
    (
      await api(`/api/v1/staff/inventory/stocktakes/${stocktakeId}/counts`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: [{ skuId: seededSkuId, countedQuantity: 12 }] }),
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await api(`/api/v1/staff/inventory/stocktakes/${stocktakeId}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'REVIEW' }),
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await api(`/api/v1/staff/inventory/stocktakes/${stocktakeId}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'POST' }),
      })
    ).status,
  ).toBe(200);

  const transfer = await api('/api/v1/staff/inventory/transfers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sourceStoreId: storeId,
      destinationStoreId: otherStoreId,
      items: [{ skuId: seededSkuId, quantity: 1 }],
    }),
  });
  expect(transfer.status).toBe(201);
  const transferId = (transfer.body as { id: string }).id;
  for (const action of ['SUBMIT', 'DISPATCH', 'RECEIVE']) {
    expect(
      (
        await api(`/api/v1/staff/inventory/transfers/${transferId}/actions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        })
      ).status,
    ).toBe(200);
  }

  // Consumer commerce uses a signed synthetic session and the same API/database.
  const cart = await consumerApi('/api/v1/commerce/cart/items', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skuId: consumerSkuId, quantity: 1 }),
  });
  expect(cart.status).toBe(200);
  const address = await consumerApi('/api/v1/commerce/addresses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recipientName: 'Synthetic E2E Recipient',
      phone: '13800000000',
      region: '四川省',
      city: '成都市',
      district: '高新区',
      addressLine: 'Synthetic E2E address',
      postalCode: '610000',
      isDefault: true,
    }),
  });
  expect(address.status).toBe(201);
  const addressId = (address.body as { id: string }).id;
  expect(
    (
      await consumerApi('/api/v1/commerce/checkout/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ addressId }),
      })
    ).status,
  ).toBe(200);
  const order = await consumerApi('/api/v1/commerce/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ addressId, clientRequestId: `e2e-order-${Date.now()}` }),
  });
  expect(order.status).toBe(201);
  const orderId = (order.body as { id: string }).id;
  expect(
    (await consumerApi(`/api/v1/commerce/orders/${orderId}/cancel`, { method: 'POST' })).status,
  ).toBe(200);

  // Rental reserve -> staff borrow -> staff return, all against synthetic stock.
  const rental = await consumerApi('/api/v1/rentals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      storeId,
      items: [{ skuId: seededSkuId, quantity: 1 }],
      idempotencyKey: crypto.randomUUID(),
    }),
  });
  expect(rental.status).toBe(201);
  const rentalBody = rental.body as { id: string; pickupCode: string | null };
  expect(rentalBody.pickupCode).toMatch(/^\d{6}$/);

  // Store staff must not escalate to HQ-only catalog, staff, finance or payment APIs.
  await page.goto(store);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByLabel('登录账号').fill(storeLogin);
  await page.getByLabel('密码').fill(storePassword);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByLabel('登录账号')).toBeHidden();
  const borrow = await api(`/api/v1/staff/rentals/${rentalBody.id}/borrow`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: crypto.randomUUID(),
      pickupCode: rentalBody.pickupCode,
    }),
  });
  expect(borrow.status).toBe(200);
  const returned = await api(`/api/v1/staff/rentals/${rentalBody.id}/return`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
  });
  expect(returned.status).toBe(200);
  for (const path of [
    '/api/v1/staff/admin/accounts',
    '/api/v1/staff/finance/summary',
    '/api/v1/staff/payments',
  ]) {
    expect((await api(path)).status).toBe(403);
  }
});
