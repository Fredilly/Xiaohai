import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StoreCatalogItem } from '@xiaohai/contracts/commerce';
import {
  StoreCatalogDraftCreateForm,
  StoreCatalogEditForm,
  StoreCatalogPanel,
  changedStoreBookFields,
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
      '可编辑本店关联商品的名称、简介、图书资料、SKU 编码、规格、上架状态、售价及本店陈列信息',
    );
    expect(html).toContain('新增图书 / 普通商品草稿');
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

  it('offers book-first store draft entry with ISBN and publisher, still unsellable', () => {
    const html = renderToStaticMarkup(
      <StoreCatalogDraftCreateForm
        token="synthetic"
        storeId="11111111-1111-4111-8111-111111111111"
        onCancel={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(html).toContain('图书</option>');
    expect(html).toContain('非图书商品（食品仍须走批次入库）');
    expect(html).toContain('书名（同时作为商品名称）');
    expect(html).toContain('作者');
    expect(html).toContain('出版社（可留空）');
    expect(html).toContain('ISBN（可留空；有值时校验格式和全库去重）');
    expect(html).toContain('默认不会公开上架或产生任何库存数量');
  });

  it('includes only modified book/edition fields and their own optimistic versions', () => {
    const item: StoreCatalogItem = {
      storeId: '11111111-1111-4111-8111-111111111111',
      productId: '22222222-2222-4222-8222-222222222222',
      skuId: '33333333-3333-4333-8333-333333333333',
      productName: '小书',
      description: null,
      productStatus: 'DRAFT',
      skuCode: 'BOOK-001',
      skuName: '标准',
      skuStatus: 'ACTIVE',
      availableForSale: false,
      priceMinor: 2300,
      coverUrl: null,
      bookTitle: '小书',
      author: '张老师',
      isbn: '9783161484100',
      publisher: '童话出版社',
      onHand: 0,
      reserved: 0,
      rentalReserved: 0,
      available: 0,
      inventoryVersion: 0,
      productVersion: 4,
      skuVersion: 5,
      bookVersion: 6,
      editionVersion: 7,
      localVersion: 8,
      shelfLocation: null,
      storeNote: null,
      displayInfo: null,
    };
    const original = {
      title: '小书',
      author: '张老师',
      isbn: '9783161484100',
      publisher: '童话出版社',
    };
    expect(changedStoreBookFields(item, original)).toEqual({});
    expect(changedStoreBookFields(item, { ...original, title: '新书名' })).toEqual({
      expectedBookVersion: 6,
      bookTitle: '新书名',
    });
    expect(changedStoreBookFields(item, { ...original, publisher: '' })).toEqual({
      expectedEditionVersion: 7,
      publisher: null,
    });
    expect(changedStoreBookFields(item, { ...original, isbn: '978-0-306-40615-7' })).toEqual({
      expectedEditionVersion: 7,
      isbn: '9780306406157',
    });
    expect(() => changedStoreBookFields(item, { ...original, isbn: '' })).toThrow('不能直接清空');
    expect(() => changedStoreBookFields(item, { ...original, isbn: '123' })).toThrow('有效格式');
    expect(() => changedStoreBookFields(item, { ...original, title: '   ' })).toThrow('非空');
    expect(changedStoreBookFields({ ...item, bookTitle: null }, original)).toEqual({});
    const html = renderToStaticMarkup(
      <StoreCatalogEditForm
        token="synthetic"
        storeId={item.storeId}
        item={item}
        onCancel={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(html).toContain('ISBN（不可直接清空已存在的 ISBN）');
    expect(html).toContain('value="童话出版社"');
    expect(html).toContain('value="9783161484100"');
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
