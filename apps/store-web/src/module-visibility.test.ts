import { describe, expect, it } from 'vitest';
import { visibleStoreModules } from './mock-data';

describe('Store Web module visibility', () => {
  it('shows only modules backed by the current Staff permissions', () => {
    const visible = visibleStoreModules(['stores.read', 'inventory.read', 'catalog.edit']).map(
      (item) => item.key,
    );

    expect(visible).toEqual(['dashboard', 'books', 'catalog', 'inventory', 'operations']);
    expect(visible).toContain('catalog');
    expect(visible).not.toContain('rental');
    expect(visible).not.toContain('orders');
    expect(visible).not.toContain('manager');
    expect(visible).not.toContain('meiping');
  });

  it('hides store catalog from migration-only reviewers and inventory-read-only without stores.read', () => {
    expect(visibleStoreModules(['meiping.correction.review']).map((v) => v.key)).not.toContain(
      'catalog',
    );
    expect(visibleStoreModules(['inventory.read']).map((v) => v.key)).not.toContain('catalog');
    expect(
      visibleStoreModules(['inventory.read', 'stores.read', 'catalog.edit']).map((v) => v.key),
    ).toContain('catalog');
    expect(visibleStoreModules(['inventory.read', 'stores.read']).map((v) => v.key)).not.toContain(
      'catalog',
    );
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

  it('exposes independent daily corrections to scoped reviewers without store mutation permissions', () => {
    expect(
      visibleStoreModules(['stores.read', 'catalog.correction.review']).map((v) => v.key),
    ).toContain('catalog-corrections');
    expect(visibleStoreModules(['stores.read', 'inventory.read']).map((v) => v.key)).not.toContain(
      'catalog-corrections',
    );
    expect(
      visibleStoreModules(['stores.read', 'inventory.read', 'inventory.stocktake']).map(
        (v) => v.key,
      ),
    ).toContain('catalog-corrections');
  });

  it('shows rental and fulfillment modules after their permissions are granted', () => {
    const visible = visibleStoreModules([
      'stores.read',
      'inventory.read',
      'rental.read',
      'fulfillment.read',
      'catalog.edit',
    ]).map((item) => item.key);

    expect(visible).toEqual(
      expect.arrayContaining(['dashboard', 'books', 'inventory', 'operations', 'rental', 'orders']),
    );
  });
});
