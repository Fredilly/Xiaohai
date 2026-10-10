import { describe, expect, it } from 'vitest';
import { visibleAdminModules } from './mock-data';

describe('HQ Admin module visibility', () => {
  it('hides business modules when the Staff context lacks their permissions', () => {
    const visible = visibleAdminModules(['stores.read', 'inventory.read']).map((item) => item.key);

    expect(visible).toContain('dashboard');
    expect(visible).toContain('stores');
    expect(visible).toContain('inventory');
    expect(visible).not.toContain('catalog');
    expect(visible).not.toContain('content');
    expect(visible).not.toContain('ai');
    expect(visible).not.toContain('franchise');
    expect(visible).not.toContain('commission');
    expect(visible).not.toContain('cms');
    expect(visible).not.toContain('staff');
  });

  it('shows each protected module after the matching permission is granted', () => {
    const permissions = [
      'catalog.manage',
      'content.manage',
      'ai.manage',
      'franchise.read',
      'commission.read',
      'cms.home.manage',
      'staff.read',
    ];
    const visible = visibleAdminModules(permissions).map((item) => item.key);

    expect(visible).toEqual(
      expect.arrayContaining(['catalog', 'content', 'ai', 'franchise', 'commission', 'cms', 'staff']),
    );
  });
});
