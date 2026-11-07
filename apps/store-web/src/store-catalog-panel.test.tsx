import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  StoreCatalogPanel,
  parseStorePriceToMinor,
  productStatus,
  skuStatus,
} from './store-catalog-panel';
describe('Store catalog direct-edit module', () => {
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
    expect(html).toContain('可编辑本店关联商品的名称、售价及本店陈列信息');
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
});
