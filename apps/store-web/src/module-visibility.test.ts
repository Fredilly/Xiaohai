import { describe, expect, it } from 'vitest';
import { visibleStoreModules } from './mock-data';

describe('Store Web module visibility', () => {
  it('shows only modules backed by the current Staff permissions', () => {
    const visible = visibleStoreModules(['stores.read', 'inventory.read']).map((item) => item.key);

    expect(visible).toEqual(['dashboard', 'books', 'inventory', 'operations']);
    expect(visible).not.toContain('rental');
    expect(visible).not.toContain('orders');
    expect(visible).not.toContain('manager');
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
      expect.arrayContaining(['dashboard', 'books', 'inventory', 'operations', 'rental', 'orders', 'manager']),
    );
  });
});
