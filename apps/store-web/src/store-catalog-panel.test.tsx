import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StoreCatalogPanel, productStatus, skuStatus } from './store-catalog-panel';
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
    expect(html).toContain('保存共享资料前，系统会显示影响门店范围并要求确认');
    expect(html).toContain('操作');
    expect(html).not.toContain('后续将单独开发');
    expect(html).not.toContain('保存商品');
    expect(html).toContain('<table');
    expect(html).toContain('scope="col"');
  });
  it('shows understandable product and SKU statuses', () => {
    expect(productStatus('DRAFT')).toBe('草稿');
    expect(productStatus('INACTIVE')).toBe('已停用');
    expect(skuStatus('ACTIVE')).toBe('有效');
  });
});
