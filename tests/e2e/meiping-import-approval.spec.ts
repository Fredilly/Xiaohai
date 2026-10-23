import { expect, test, type Page, type Route } from '@playwright/test';

const staffId = '10000000-0000-4000-8000-000000000001';
const reviewerId = '10000000-0000-4000-8000-000000000002';
const storeId = '20000000-0000-4000-8000-000000000001';
const regionId = '30000000-0000-4000-8000-000000000001';
const sessionId = '40000000-0000-4000-8000-000000000001';
const batchId = '50000000-0000-4000-8000-000000000001';
const checksum = 'a'.repeat(64);
const permissions = [
  'stores.read',
  'inventory.receive',
  'inventory.stocktake',
  'meiping.import.preview',
  'meiping.import.approve',
  'meiping.import.execute',
];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installApiFixture(page: Page) {
  let resolvedPreview = false;
  await page.route('**/api/v1/staff/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const authorization = request.headers().authorization ?? '';
    const reviewer = authorization.includes('reviewer-token');

    if (url.pathname.endsWith('/auth/login')) {
      const payload = request.postDataJSON() as { loginIdentifier: string };
      const isReviewer = payload.loginIdentifier === 'uat.reviewer';
      return json(route, {
        staff: {
          id: isReviewer ? reviewerId : staffId,
          loginIdentifier: payload.loginIdentifier,
        },
        session: {
          token: isReviewer ? 'reviewer-token' : 'creator-token',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      });
    }
    if (url.pathname.endsWith('/staff/me')) {
      return json(route, {
        staff: {
          id: reviewer ? reviewerId : staffId,
          loginIdentifier: reviewer ? 'uat.reviewer' : 'uat.creator',
        },
        permissions,
        dataScopes: [{ type: 'STORE', id: storeId }],
      });
    }
    if (url.pathname.endsWith('/staff/stores')) {
      return json(route, {
        stores: [
          {
            id: storeId,
            code: 'E2E-A',
            name: 'E2E 隔离测试门店',
            region: {
              id: regionId,
              code: 'E2E-R',
              name: 'E2E 区域',
              countryCode: 'CN',
              countryName: '中国',
            },
            countryCode: 'CN',
            countryName: '中国',
            city: '成都',
            timezone: 'Asia/Shanghai',
            addressLine: '仅用于自动化测试',
            latitude: 30.6,
            longitude: 104.1,
            phone: null,
            openingHoursText: null,
            services: [],
            franchisee: null,
            operationalStatus: 'ACTIVE',
          },
        ],
      });
    }
    if (
      request.method() === 'GET' &&
      url.pathname.endsWith('/migrations/meiping/review-sessions')
    ) {
      return json(route, {
        storeId,
        offset: 0,
        limit: 20,
        hasMore: false,
        items: [
          {
            id: sessionId,
            storeId,
            status: 'DRAFT',
            sourceChecksum: checksum,
            totalRows: 1,
            savedDecisions: 1,
            createdAt: '2026-10-23T00:00:00.000Z',
            approved: false,
            catalogOrInventoryWritten: false,
          },
        ],
      });
    }
    if (
      request.method() === 'GET' &&
      url.pathname.endsWith(`/migrations/meiping/review-sessions/${sessionId}`)
    ) {
      return json(route, {
        sessionId,
        storeId,
        sourceChecksum: checksum,
        status: 'DRAFT',
        approved: false,
        catalogOrInventoryWritten: false,
        totalRows: 1,
        offset: 0,
        limit: 25,
        items: [
          {
            sourceRowNumber: 2,
            disposition: 'CREATE_CANDIDATE',
            sourceIdentifiers: {
              bookCode: null,
              internalCode: null,
              barcode: null,
              isbn: '9780306406157',
            },
            normalized: {
              title: 'E2E 图书',
              author: '测试作者',
              publisher: null,
              priceMinor: 1200,
            },
            issueCodes: [],
            saleBlocked: false,
            decision: {
              sourceRowNumber: 2,
              action: 'CREATE_DRAFT',
              countedQuantity: 1,
              reason: null,
              version: 1,
              updatedAt: '2026-10-23T00:00:00.000Z',
            },
          },
        ],
      });
    }
    if (url.pathname.endsWith(`/review-sessions/${sessionId}/import-preview`)) {
      const conflicts = resolvedPreview
        ? []
        : [{ sourceRowNumber: 2, code: 'INVENTORY_ALREADY_INITIALIZED' }];
      resolvedPreview = true;
      return json(route, {
        batchId,
        created: true,
        status: 'PREVIEW',
        canExecute: false,
        plan: {
          sourceChecksum: checksum,
          storeId,
          totalRows: 1,
          includedRows: 1,
          excludedRows: 0,
          conflicts,
          counts: {
            newBooks: 1,
            reusedBooks: 0,
            newProducts: 1,
            reusedProducts: 0,
            newSkus: 1,
            reusedSkus: 0,
            inventoryConflicts: conflicts.length,
            duplicateRisks: 0,
          },
          rows: [
            {
              sourceRowNumber: 2,
              title: 'E2E 图书',
              author: '测试作者',
              publisher: null,
              isbn: '9780306406157',
              barcode: null,
              priceMinor: 1200,
              countedQuantity: 1,
              acceptedCorrectionVersion: null,
              resolution: { book: 'CREATE', product: 'CREATE', sku: 'CREATE' },
            },
          ],
        },
      });
    }
    if (url.pathname.endsWith(`/import-batches/${batchId}/approve`)) {
      return reviewer
        ? json(route, { batchId, status: 'APPROVED', approved: true, executed: false })
        : json(route, { error: { code: 'MEIPING_IMPORT_SEPARATION_REQUIRED' } }, 409);
    }
    return json(route, { error: { code: 'UNEXPECTED_E2E_REQUEST' } }, 500);
  });
}

async function login(page: Page, user: string) {
  await page.goto('/#/meiping');
  await page.getByLabel('登录账号').fill(user);
  await page.getByLabel('密码').fill('local-e2e-password');
  await page.getByRole('button', { name: '登录后台' }).click();
  await expect(page.getByRole('heading', { name: '美萍导入预检查' })).toBeVisible();
}

async function openDraft(page: Page) {
  await page.getByLabel('授权门店').selectOption(storeId);
  await expect(page.getByText('DRAFT · 1 条商品记录')).toBeVisible();
  await page.getByRole('button', { name: '继续审核' }).click();
  await expect(page.getByRole('heading', { name: '商品资料与人工盘点审核' })).toBeVisible();
}

test('Staff login, review draft, Dry Run conflict, independent approval, and disabled execution', async ({
  page,
}) => {
  await installApiFixture(page);
  await login(page, 'uat.creator');
  await openDraft(page);

  await page.getByRole('button', { name: '生成 Dry Run 预览' }).click();
  await expect(page.getByText('存在 1 条冲突')).toBeVisible();
  await page.getByRole('button', { name: '生成 Dry Run 预览' }).click();
  await expect(page.getByText('新增图书')).toBeVisible();
  await expect(page.getByText('存在 1 条冲突')).toBeHidden();
  await page.getByRole('button', { name: '记录独立最终批准' }).click();
  await expect(page.getByText('MEIPING_IMPORT_SEPARATION_REQUIRED')).toBeVisible();

  await page.getByRole('button', { name: '退出' }).click();
  await login(page, 'uat.reviewer');
  await openDraft(page);
  await page.getByRole('button', { name: '生成 Dry Run 预览' }).click();
  await page.getByRole('button', { name: '记录独立最终批准' }).click();
  await expect(page.getByText('已记录独立最终导入批准')).toBeVisible();
  await expect(page.getByRole('button', { name: '执行隔离导入' })).toHaveCount(0);
  await expect(page.getByText('正式入库：未开放')).toBeVisible();
});
