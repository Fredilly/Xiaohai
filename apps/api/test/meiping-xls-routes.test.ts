import Fastify from 'fastify';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { ConsumerAuthError } from '../src/auth/errors.js';
import { inventoryPermissions } from '../src/inventory/inventory-operations-service.js';
import { registerMeipingXlsRoutes } from '../src/migration/meiping-xls-routes.js';
import type { StaffAuthorizationContext } from '../src/auth/staff-authorization.js';

function workbookBuffer() {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['商品编号', '商品名称', '作者', '出版社', '价格', '条码', '类别'],
    ['M-API-001', 'API 测试绘本', '测试作者', '测试出版社', '18', '690000000101', '图书'],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '商品资料');
  const output = XLSX.write(workbook, { type: 'buffer', bookType: 'xls' }) as unknown;
  if (!(output instanceof Uint8Array)) throw new Error('Unexpected workbook output');
  return Buffer.from(output);
}

describe('Meiping preflight API', () => {
  it('requires staff permission and store scope, then returns a read-only preview or CSV', async () => {
    const app = Fastify({ logger: false });
    let permission: string | undefined;
    registerMeipingXlsRoutes(app, {
      staffAuthorization: {
        authenticate: () =>
          Promise.resolve({
            staffAccountId: 'staff',
            loginIdentifier: 'staff',
            permissions: [inventoryPermissions.receive],
            dataScopes: [{ type: 'STORE', id: 'store-test' }],
          }),
        requirePermission: (_context: StaffAuthorizationContext, value: string) => {
          permission = value;
        },
      } as never,
      stores: {
        getStaffStore: () => Promise.resolve({ id: 'store-test', code: 'TEST-EAST' }),
      } as never,
      inventory: { requireStoreAccess: () => Promise.resolve({ id: 'store-test' }) } as never,
      db: {} as never,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/migrations/meiping/preflight?storeId=11111111-1111-4111-8111-111111111111',
      headers: { 'content-type': 'application/vnd.ms-excel', authorization: 'Bearer test' },
      payload: workbookBuffer(),
    });
    expect(response.statusCode).toBe(200);
    expect(permission).toBe(inventoryPermissions.receive);
    expect(response.json()).toMatchObject({
      sourceType: 'MEIPING_XLS',
      sourceStoreCode: 'TEST-EAST',
      totalRows: 1,
      createCandidateRows: 1,
      inventoryApproval: 'PENDING_ADMIN_REVIEW',
    });

    const csv = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/migrations/meiping/preflight?storeId=11111111-1111-4111-8111-111111111111&format=csv',
      headers: { 'content-type': 'application/vnd.ms-excel', authorization: 'Bearer test' },
      payload: workbookBuffer(),
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('source_row_number');
    await app.close();
  });

  it('does not expose the preview without staff authentication', async () => {
    const app = Fastify({ logger: false });
    registerMeipingXlsRoutes(app, {
      staffAuthorization: {
        authenticate: () =>
          Promise.reject(new ConsumerAuthError('STAFF_AUTHENTICATION_REQUIRED', 401)),
      } as never,
      stores: {} as never,
      inventory: {} as never,
      db: {} as never,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/migrations/meiping/preflight?storeId=11111111-1111-4111-8111-111111111111',
      headers: { 'content-type': 'application/vnd.ms-excel' },
      payload: workbookBuffer(),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
