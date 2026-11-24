import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { InventoryPanel } from './inventory-panel';

const props = {
  token: 'test',
  storeId: '11111111-1111-4111-8111-111111111111',
};

describe('first stock catalog registration UI', () => {
  it('shows the guarded opening workflow for inventory adjusters', () => {
    const html = renderToStaticMarkup(
      <InventoryPanel {...props} permissions={['inventory.read', 'inventory.adjust']} />,
    );
    expect(html).toContain('首次库存建档');
    expect(html).toContain('搜索待建档 SKU');
    expect(html).toContain('总部先建立商品草稿');
    expect(html).toContain('库存流水');
  });

  it('does not offer opening stock writes to read-only users', () => {
    const html = renderToStaticMarkup(
      <InventoryPanel {...props} permissions={['inventory.read']} />,
    );
    expect(html).not.toContain('搜索待建档 SKU');
    expect(html).not.toContain('确认首次库存建档');
  });
});
