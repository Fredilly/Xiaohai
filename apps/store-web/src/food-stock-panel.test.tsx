import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FoodStockPanel } from './food-stock-panel';
describe('food operations entry', () => {
  it('requires an explicit scoped SKU before exposing writes and states checkout is disabled', () => {
    const html = renderToStaticMarkup(
      <FoodStockPanel
        token="synthetic"
        storeId="11111111-1111-4111-8111-111111111111"
        staffAccountId="66666666-6666-4666-8666-666666666666"
        permissions={['inventory.read', 'inventory.receive']}
        items={[{ skuId: '22222222-2222-4222-8222-222222222222', skuName: 'Synthetic bottle' }]}
      />,
    );
    expect(html).toContain('Synthetic bottle');
    expect(html).toContain('食品下单状态以服务端配置和实时批次校验为准');
    expect(html).not.toContain('入库并冻结');
  });
});
