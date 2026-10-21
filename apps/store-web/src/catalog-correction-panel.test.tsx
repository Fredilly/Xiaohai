import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CatalogCorrectionPanel, correctionStatus, priceToMinor } from './catalog-correction-panel';

describe('daily catalog correction UI safety', () => {
  const storeId = '11111111-1111-4111-8111-111111111111';

  it('uses explicit non-application wording for both review and creation', () => {
    const html = renderToStaticMarkup(
      <CatalogCorrectionPanel
        token="mock"
        storeId={storeId}
        storeName="虚拟门店"
        permissions={[
          'stores.read',
          'inventory.read',
          'inventory.stocktake',
          'catalog.correction.review',
        ]}
      />,
    );
    expect(html).toContain('虚拟门店');
    expect(html).toContain('不会');
    expect(html).toContain('提交纠错建议（不改商品）');
    expect(html).not.toContain('保存商品');
  });

  it('does not present a submission form to independent reviewer without inventory permissions', () => {
    const html = renderToStaticMarkup(
      <CatalogCorrectionPanel
        token="mock"
        storeId={storeId}
        storeName="复核门店"
        permissions={['stores.read', 'catalog.correction.review']}
      />,
    );
    expect(html).not.toContain('提交纠错建议（不改商品）');
  });

  it('uses exact integer minor units and clear request statuses', () => {
    expect(priceToMinor('28.50')).toBe('2850');
    expect(priceToMinor('0')).toBe('0');
    expect(priceToMinor('-1')).toBeNull();
    expect(priceToMinor('22.123')).toBeNull();
    expect(correctionStatus('ACCEPTED')).toContain('未生效');
  });
});
