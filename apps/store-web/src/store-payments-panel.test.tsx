import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StorePaymentsPanel } from './store-payments-panel';
import { visibleStoreModules } from './mock-data';
describe('store-scoped financial operations entry', () => {
  it('exposes no payment module without explicit read permission', () => {
    expect(visibleStoreModules(['inventory.read']).some((r) => r.key === 'payments')).toBe(false);
    expect(visibleStoreModules(['payments.read']).some((r) => r.key === 'payments')).toBe(true);
  });
  it('explains the financial/physical boundary and shows no unsolicited refund action', () => {
    const html = renderToStaticMarkup(
      <StorePaymentsPanel
        token="synthetic-token"
        storeId="11111111-1111-4111-8111-111111111111"
        permissions={['payments.read']}
      />,
    );
    expect(html).toContain('退款和实物退货分开处理');
    expect(html).not.toContain('synthetic-token');
    expect(html).not.toContain('整单退款（不返实物）</button>');
  });
});
