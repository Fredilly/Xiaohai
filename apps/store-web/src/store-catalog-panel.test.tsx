import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StoreCatalogItem } from '@xiaohai/contracts/commerce';
import {
  StoreCatalogEditForm,
  StoreCatalogPanel,
  parseStorePriceToMinor,
  productStatus,
  skuStatus,
} from './store-catalog-panel';
describe('Store catalog direct-edit module', () => {
  it('remounts the entire editor session on a store or login switch', () => {
    const props = {
      token: 'session-a',
      storeId: '11111111-1111-4111-8111-111111111111',
      storeName: '东门',
    };
    const east = StoreCatalogPanel(props);
    const south = StoreCatalogPanel({ ...props, storeId: '33333333-3333-4333-8333-333333333333' });
    const anotherLogin = StoreCatalogPanel({ ...props, token: 'session-b' });
    expect(east.key).toBe('session-a:11111111-1111-4111-8111-111111111111');
    expect(south.key).not.toBe(east.key);
    expect(anotherLogin.key).not.toBe(east.key);
  });

  it('describes store-scoped product data and guarded direct writes', () => {
    const html = renderToStaticMarkup(
      <StoreCatalogPanel
        token="mock"
        storeId="11111111-1111-4111-8111-111111111111"
        storeName="虚拟门店"
      />,
    );
    expect(html).toContain('虚拟门店');
    expect(html).toContain('店铺账号可编辑');
    expect(html).toContain('库存数量仍须通过库存盘点或调整流程变更');
    expect(html).toContain(
      '可编辑本店关联商品的名称、简介、SKU 编码、规格、上架状态、售价及本店陈列信息',
    );
    expect(html).toContain('新增非图书商品草稿');
    expect(html).toContain('新商品默认未上架、不可售、库存为 0');
    expect(html).toContain('若商品资料还影响其他门店');
    expect(html).toContain('操作');
    expect(html).not.toContain('后续将单独开发');
    expect(html).not.toContain('总部共享主数据，请通过商品纠错申请');
    expect(html).toContain('<table');
    expect(html).toContain('scope="col"');
  });
  it('parses store retail prices without fractional fen or overflow', () => {
    expect(parseStorePriceToMinor('0')).toBe(0);
    expect(parseStorePriceToMinor('39.80')).toBe(3980);
    expect(parseStorePriceToMinor('1.2')).toBe(120);
    expect(parseStorePriceToMinor('21474836.47')).toBe(2147483647);
    for (const invalid of ['', '39.', '39.999', '-1', '1e3', '1,000', '999999999999999999']) {
      expect(parseStorePriceToMinor(invalid)).toBeNull();
    }
  });

  it('shows understandable product and SKU statuses', () => {
    expect(productStatus('DRAFT')).toBe('草稿');
    expect(productStatus('INACTIVE')).toBe('已停用');
    expect(skuStatus('ACTIVE')).toBe('有效');
  });

  it('requires a visible manual confirmation for draft publication and SKU availability', () => {
    const item: StoreCatalogItem = {
      storeId: '11111111-1111-4111-8111-111111111111',
      productId: '22222222-2222-4222-8222-222222222222',
      skuId: '33333333-3333-4333-8333-333333333333',
      productName: '南门样品',
      description: '描述',
      productStatus: 'DRAFT',
      skuCode: 'SOUTH-SAMPLE',
      skuName: '标准',
      skuStatus: 'ACTIVE',
      availableForSale: false,
      priceMinor: 1900,
      coverUrl: null,
      bookTitle: null,
      author: null,
      isbn: null,
      publisher: null,
      onHand: 0,
      reserved: 0,
      rentalReserved: 0,
      available: 0,
      inventoryVersion: 0,
      productVersion: 0,
      skuVersion: 0,
      bookVersion: 0,
      editionVersion: 0,
      localVersion: 0,
      shelfLocation: null,
      storeNote: null,
      displayInfo: null,
    };
    const html = renderToStaticMarkup(
      <StoreCatalogEditForm
        token="synthetic"
        storeId={item.storeId}
        item={item}
        onCancel={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(html).toContain('SKU 编码 / 条码');
    expect(html).toContain('商品简介（最多 4000 字）');
    expect(html).toContain('商品规格 / SKU 名称');
    expect(html).toContain('草稿（不展示）');
    expect(html).toContain('已上架（可展示）');
    expect(html).toContain('允许销售（仍受真实库存、食品安全开关和结算门禁限制）');
    expect(html).toContain('我已核对商品资料、图片及库存');
    expect(html).toContain('disabled=""');
  });
});
