import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FoodTraceabilityPanel } from './food-traceability-panel';
describe('physical food return and provenance entry', () => {
  it('separates financial refund from physical receipt and offers no unchecked stock write', () => {
    const html = renderToStaticMarkup(
      <FoodTraceabilityPanel
        token="synthetic"
        storeId="11111111-1111-4111-8111-111111111111"
        permissions={['inventory.read']}
      />,
    );
    expect(html).toContain('退款仅处理金额');
    expect(html).toContain('读取原订单批次');
    expect(html).toContain('查询批次来源');
    expect(html).not.toContain('接收为冻结批次');
    expect(html).not.toContain('synthetic');
  });
});
