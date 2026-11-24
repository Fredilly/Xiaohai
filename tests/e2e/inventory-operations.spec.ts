import { expect, test, type Page } from '@playwright/test';

const storeId = '11111111-1111-4111-8111-111111111111';
const otherStoreId = '33333333-3333-4333-8333-333333333333';
const skuId = '22222222-2222-4222-8222-222222222222';
const balance = {
  storeId,
  skuId,
  skuName: '绘本甲',
  skuCode: 'BOOK-1',
  onHand: 5,
  reserved: 0,
  rentalReserved: 0,
  available: 5,
  version: 1,
};
const report = {
  sourceType: 'MEIPING_XLS',
  sourceStoreId: storeId,
  sourceChecksum: 'a'.repeat(64),
  inventoryApproval: 'PENDING_ADMIN_REVIEW',
  totalRows: 10,
  matchedRows: 2,
  createCandidateRows: 7,
  exceptionRows: 1,
  metadataWarningRows: 4,
  blockingRows: 1,
  saleBlockedRows: 0,
  assumedInventoryRows: 10,
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function mount(page: Page, preflight = false) {
  await page.goto('/test/inventory.html');
  await page.waitForFunction(() => 'fixtureReady' in window);
  await switchStore(page, storeId, preflight);
}
async function switchStore(page: Page, selected: string, preflight = false) {
  await page.evaluate(
    (props) => {
      window.dispatchEvent(new CustomEvent('inventory-props', { detail: props }));
    },
    {
      token: 'synthetic-staff-session',
      storeId: selected,
      permissions: ['inventory.read', 'inventory.adjust', 'inventory.issue', 'inventory.receive'],
      preflight,
    },
  );
}
async function upload(page: Page) {
  await page.getByLabel('选择美萍 Excel 文件').setInputFiles({
    name: 'synthetic.xls',
    mimeType: 'application/vnd.ms-excel',
    buffer: Buffer.from('fixture'),
  });
}

test('a late inventory search never overwrites the newer result', async ({ page }) => {
  const first = deferred();
  const arrived = deferred();
  await page.route('**/api/v1/staff/inventory?*', async (route) => {
    if (!new URL(route.request().url()).searchParams.has('q')) {
      arrived.resolve();
      await first.promise;
      await route.fulfill({ json: { items: [balance] } });
    } else await route.fulfill({ json: { items: [{ ...balance, skuName: '最新搜索结果' }] } });
  });
  await mount(page);
  await arrived.promise;
  await page.getByLabel('查询已有库存 SKU').fill('最新');
  await page.getByRole('button', { name: '查询库存', exact: true }).click();
  await expect(page.locator('table')).toContainText('最新搜索结果');
  const oldResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/inventory?') && !new URL(response.url()).searchParams.has('q'),
  );
  first.resolve();
  await oldResponse;
  await expect(page.locator('table')).not.toContainText('绘本甲');
  await expect(page.locator('table')).toContainText('最新搜索结果');
});

test('lost write response retries the identical request and duplicate submit is blocked', async ({
  page,
}) => {
  await page.route('**/api/v1/staff/inventory?*', (route) =>
    route.fulfill({ json: { items: [balance] } }),
  );
  const pending = deferred();
  const arrived = deferred();
  const writes: unknown[] = [];
  await page.route('**/api/v1/staff/inventory/issues', async (route) => {
    writes.push(route.request().postDataJSON());
    if (writes.length === 1) {
      arrived.resolve();
      await pending.promise;
      await route.abort('failed');
    } else await route.fulfill({ json: { id: 'synthetic-ledger-entry' } });
  });
  await mount(page);
  const form = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: '提交库存操作' }) });
  await form.locator('select').first().selectOption(`${storeId}:${skuId}`);
  await form.locator('[name=quantity]').fill('2');
  await form.locator('[name=reason]').fill('实盘出库');
  await form.evaluate((element) => {
    element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await arrived.promise;
  await expect(form.locator('[name=quantity]')).toBeDisabled();
  expect(writes).toHaveLength(1);
  pending.resolve();
  await expect(page.getByRole('status').last()).toContainText('操作失败');
  await form.getByRole('button', { name: '提交库存操作' }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toEqual(writes[0]);
  await expect(form.locator('[name=quantity]')).toHaveValue('');
});

test('switching stores discards opening candidates and their selected SKU', async ({ page }) => {
  await page.route('**/api/v1/staff/inventory?*', (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route('**/opening-candidates?*', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            skuId,
            skuCode: 'DRAFT-1',
            skuName: '未建档商品',
            productName: '草稿',
            productStatus: 'DRAFT',
            skuStatus: 'ACTIVE',
          },
        ],
      },
    }),
  );
  await mount(page);
  await page.getByLabel('搜索待建档商品').fill('草稿');
  await page.getByRole('button', { name: '搜索待建档 SKU' }).click();
  await page.getByLabel('选择待建档 SKU').selectOption(skuId);
  await switchStore(page, otherStoreId);
  await expect(page.getByLabel('选择待建档 SKU')).toHaveCount(0);
  await expect(page.getByLabel('搜索待建档商品')).toHaveValue('');
});

test('a completed preflight for the old store is not displayed in the new store', async ({
  page,
}) => {
  const pending = deferred();
  const arrived = deferred();
  await page.route('**/preflight?*', async (route) => {
    arrived.resolve();
    await pending.promise;
    await route.fulfill({ json: report });
  });
  await mount(page, true);
  await upload(page);
  await page.getByRole('button', { name: '预检查 Excel', exact: true }).click();
  await arrived.promise;
  await switchStore(page, otherStoreId, true);
  await expect(page.getByRole('status')).toContainText('选择门店对应');
  const response = page.waitForResponse('**/preflight?*');
  pending.resolve();
  await response;
  await expect(page.getByLabel('Excel 预检查结果')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '预检查 Excel', exact: true })).toBeDisabled();
});

test('exception downloads carry store and fingerprint and reject a JSON body', async ({ page }) => {
  let validCsv = false;
  await page.route('**/preflight?*', (route) => {
    if (new URL(route.request().url()).searchParams.get('format') === 'json')
      return route.fulfill({ json: report });
    return validCsv
      ? route.fulfill({
          contentType: 'text/csv; charset=utf-8',
          body: 'row,code\n2,DUPLICATE_BARCODE',
        })
      : route.fulfill({ json: { unexpected: true } });
  });
  await mount(page, true);
  await upload(page);
  await page.getByRole('button', { name: '预检查 Excel', exact: true }).click();
  await expect(page.getByLabel('Excel 预检查结果')).toContainText(report.sourceChecksum);
  await page.getByRole('button', { name: '下载异常明细 CSV' }).click();
  await expect(page.getByRole('status')).toContainText('INVALID_PREFLIGHT_CSV_RESPONSE');
  validCsv = true;
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载异常明细 CSV' }).click();
  expect((await download).suggestedFilename()).toBe(
    `meiping-${storeId}-aaaaaaaaaaaa-exceptions.csv`,
  );
});

test('read-only staff cannot submit inventory writes and single-permission operators see only their operation', async ({
  page,
}) => {
  await page.route('**/api/v1/staff/inventory?*', (route) =>
    route.fulfill({ json: { items: [balance] } }),
  );
  await mount(page);
  for (const permission of [null, 'inventory.issue', 'inventory.adjust']) {
    await page.evaluate(
      (props) => {
        window.dispatchEvent(new CustomEvent('inventory-props', { detail: props }));
      },
      {
        token: 'synthetic-staff-session',
        storeId,
        permissions: ['inventory.read', ...(permission ? [permission] : [])],
      },
    );
    if (!permission) {
      await expect(page.getByRole('button', { name: '提交库存操作' })).toHaveCount(0);
    } else {
      await expect(page.locator('[name=operation] option')).toHaveCount(1);
      await expect(page.locator('[name=operation]')).toHaveValue(
        permission === 'inventory.issue' ? 'ISSUE' : 'ADJUST',
      );
    }
  }
});

const foodBatchId = '44444444-4444-4444-8444-444444444444';
const orderId = '55555555-5555-4555-8555-555555555555';
const allocationId = '66666666-6666-4666-8666-666666666666';
async function ordinaryInventoryFixture(page: Page) {
  await page.route('**/api/v1/staff/inventory?*', (route) =>
    route.fulfill({ json: { items: [balance] } }),
  );
}
test('food intake network retry retains the original operation key', async ({ page }) => {
  await ordinaryInventoryFixture(page);
  await page.route('**/api/v1/staff/inventory/food-stock?*', (route) =>
    route.fulfill({
      json: {
        storeId,
        skuId,
        businessDate: '2026-11-24',
        inventoryVersion: 1,
        onHand: 5,
        checkoutEnabled: false,
        rows: [
          {
            id: foodBatchId,
            lotCode: 'SYNTHETIC',
            kind: 'PACKAGED_FOOD',
            manufacturedOn: null,
            expiresOn: '2099-01-01',
            onHand: 5,
            reserved: 0,
            blocked: 0,
            state: 'HELD',
            version: 0,
          },
        ],
        result: {
          status: 'READY',
          sellable: 0,
          expiredOnHand: 0,
          blockedOnHand: 5,
          batches: [{ id: foodBatchId, expiresOn: '2099-01-01', disposition: 'HELD', sellable: 0 }],
        },
      },
    }),
  );
  const keys: string[] = [];
  await page.route('**/api/v1/staff/inventory/food-stock/intake', async (route) => {
    const body = route.request().postDataJSON() as { idempotencyKey: string };
    keys.push(body.idempotencyKey);
    if (keys.length === 1) await route.abort('failed');
    else await route.fulfill({ status: 201, json: { replayed: true } });
  });
  await mount(page);
  await page.getByLabel('本店 SKU', { exact: true }).selectOption(skuId);
  const form = page.getByRole('group', { name: '新批次入库（新食品须先建草稿、关联零库存）' });
  await form.getByLabel('批号', { exact: true }).fill('SYNTHETIC-NEW');
  await form.getByLabel('到期日').fill('2099-12-31');
  await form.getByLabel('入库数量').fill('2');
  await form.getByLabel('原因', { exact: true }).fill('Synthetic receipt');
  await form.getByLabel('内部凭证编号（不填网址）').fill('synthetic:receipt:1');
  await form.getByRole('button', { name: '入库并冻结' }).click();
  await expect(page.getByRole('status').filter({ hasText: '未确认成功' })).toHaveCount(1);
  await form.getByRole('button', { name: '入库并冻结' }).click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[0]).toBe(keys[1]);
});
test('physical receipt keeps the same key when the post-success refresh fails', async ({
  page,
}) => {
  await ordinaryInventoryFixture(page);
  let reads = 0;
  await page.route(`**/api/v1/staff/inventory/food-stock/order/${orderId}`, async (route) => {
    reads++;
    if (reads === 2)
      await route.fulfill({ status: 503, json: { error: { code: 'SYNTHETIC_UNAVAILABLE' } } });
    else
      await route.fulfill({
        json: {
          orderId,
          storeId,
          status: 'COMPLETED',
          allocations: [
            {
              id: allocationId,
              skuId,
              batchId: foodBatchId,
              lotCode: 'SYNTHETIC',
              quantity: 2,
              status: 'SOLD',
              returnedQuantity: reads > 2 ? 1 : 0,
            },
          ],
        },
      });
  });
  const keys: string[] = [];
  await page.route('**/api/v1/staff/inventory/food-stock/physical-returns', (route) => {
    const body = route.request().postDataJSON() as { idempotencyKey: string };
    keys.push(body.idempotencyKey);
    return route.fulfill({ json: { returnedBatchId: foodBatchId, replayed: keys.length > 1 } });
  });
  await mount(page);
  const panel = page.getByRole('region', { name: '食品退货与溯源' });
  await panel.getByLabel('原订单 ID').fill(orderId);
  await panel.getByRole('button', { name: '读取原订单批次' }).click();
  const form = panel.getByRole('group', { name: '确认收到实物（与退款分开）' });
  await form.getByLabel('实际收到数量').fill('1');
  await form.getByLabel('原因', { exact: true }).fill('Synthetic physical receipt');
  await form.getByLabel('内部接收凭证').fill('synthetic:return:1');
  await form.getByRole('button', { name: '接收为冻结批次' }).click();
  await expect(panel.getByRole('status')).toContainText('未确认成功');
  await form.getByRole('button', { name: '接收为冻结批次' }).click();
  await expect(panel.getByRole('status')).toContainText('没有自动退款');
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});
test('a mismatched store trace response is never displayed', async ({ page }) => {
  await ordinaryInventoryFixture(page);
  await page.route(`**/api/v1/staff/inventory/food-stock/trace/${foodBatchId}`, (route) =>
    route.fulfill({
      json: {
        batchId: foodBatchId,
        storeId: otherStoreId,
        lotCode: 'OTHER_STORE_MUST_NOT_RENDER',
        transfers: [],
        returns: [],
      },
    }),
  );
  await mount(page);
  const panel = page.getByRole('region', { name: '食品退货与溯源' });
  await panel.getByLabel('本店批次 ID').fill(foodBatchId);
  await panel.getByRole('button', { name: '查询批次来源' }).click();
  await expect(panel.getByRole('status')).toContainText('未确认成功');
  await expect(panel).not.toContainText('OTHER_STORE_MUST_NOT_RENDER');
});
