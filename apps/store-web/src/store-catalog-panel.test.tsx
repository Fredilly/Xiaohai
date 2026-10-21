import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StoreCatalogPanel, productStatus, skuStatus } from './store-catalog-panel';
describe('Store catalog read-only module', () => {
  it('describes store-scoped product data and no direct writes', () => {
    const html = renderToStaticMarkup(
      <StoreCatalogPanel
        token="mock"
        storeId="11111111-1111-4111-8111-111111111111"
        storeName="虚拟门店"
      />,
    );
    expect(html).toContain('虚拟门店');
    expect(html).toContain('门店只读');
    expect(html).toContain('不能直接在这里修改全局商品资料');
    expect(html).toContain('「商品纠错申请」');
    expect(html).toContain('不会自动修改正式商品或库存');
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
