import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CatalogCorrectionPanel,
  correctionStatus,
  isOwnCorrection,
  priceToMinor,
  selectableCorrectionFields,
} from './catalog-correction-panel';

describe('daily catalog correction UI safety', () => {
  const storeId = '11111111-1111-4111-8111-111111111111';

  it('uses explicit non-application wording for both review and creation', () => {
    const html = renderToStaticMarkup(
      <CatalogCorrectionPanel
        token="mock"
        staffAccountId="22222222-2222-4222-8222-222222222222"
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
        staffAccountId="22222222-2222-4222-8222-222222222222"
        storeId={storeId}
        storeName="复核门店"
        permissions={['stores.read', 'catalog.correction.review']}
      />,
    );
    expect(html).not.toContain('提交纠错建议（不改商品）');
  });

  it('defaults to a safe field for a non-book product and only offers book fields for books', () => {
    const html = renderToStaticMarkup(
      <CatalogCorrectionPanel
        token="mock"
        staffAccountId="22222222-2222-4222-8222-222222222222"
        storeId={storeId}
        storeName="虚拟门店"
        permissions={['stores.read', 'inventory.read', 'inventory.stocktake']}
      />,
    );
    expect(html).toContain('<option value="productName"');
    expect(html).not.toContain('<option value="bookTitle"');
    expect(selectableCorrectionFields(null).map((item) => item.key)).toEqual([
      'productName',
      'priceMinor',
    ]);
    expect(selectableCorrectionFields('绘本').map((item) => item.key)).toContain('bookTitle');
  });

  it('marks the request author as ineligible for their own independent review', () => {
    const requester = '22222222-2222-4222-8222-222222222222';
    const reviewer = '33333333-3333-4333-8333-333333333333';
    expect(isOwnCorrection(requester, requester)).toBe(true);
    expect(isOwnCorrection(requester, reviewer)).toBe(false);
  });

  it('uses exact integer minor units and clear request statuses', () => {
    expect(priceToMinor('28.50')).toBe('2850');
    expect(priceToMinor('0')).toBe('0');
    expect(priceToMinor('-1')).toBeNull();
    expect(priceToMinor('22.123')).toBeNull();
    expect(correctionStatus('ACCEPTED')).toContain('未生效');
  });
});
