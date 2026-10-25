import { describe, expect, it } from 'vitest';
import { visibleStoreModules } from './mock-data';

describe('Store Web module visibility', () => {
  it('shows only modules backed by the current Staff permissions', () => {
    const visible = visibleStoreModules(['stores.read', 'inventory.read']).map((item) => item.key);

    expect(visible).toEqual(['dashboard', 'books', 'inventory', 'operations']);
    expect(visible).not.toContain('rental');
    expect(visible).not.toContain('orders');
    expect(visible).not.toContain('manager');
    expect(visible).not.toContain('meiping');
  });

  it('lets a reviewer open the migration draft without inventory write permissions', () => {
    const reviewer = visibleStoreModules(['stores.read', 'meiping.correction.review']).map(
      (item) => item.key,
    );
    expect(reviewer).toContain('meiping');
    expect(reviewer).not.toContain('inventory');
    expect(reviewer).not.toContain('operations');
    expect(visibleStoreModules(['inventory.stocktake']).map((item) => item.key)).not.toContain(
      'meiping',
    );
    expect(
      visibleStoreModules(['inventory.receive', 'inventory.stocktake']).map((item) => item.key),
    ).toContain('meiping');
  });

  it('shows rental, fulfillment, and manager modules only after their permissions are granted', () => {
    const visible = visibleStoreModules([
      'stores.read',
      'inventory.read',
      'rental.read',
      'fulfillment.read',
      'stores.manage',
    ]).map((item) => item.key);

    expect(visible).toEqual(
      expect.arrayContaining([
        'dashboard',
        'books',
        'inventory',
        'operations',
        'rental',
        'orders',
        'manager',
      ]),
    );
  });
});
