import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StaffMeResponse } from '@xiaohai/contracts';
import { MeipingPreflightManager } from './meiping-preflight-manager';
import { visibleAdminModules } from './mock-data';

function render(permissions: string[]) {
  return renderToStaticMarkup(
    <MeipingPreflightManager token="test-session" me={{ permissions } as StaffMeResponse} />,
  );
}

describe('independent correction review entrance', () => {
  it('exposes the Meiping navigation for a dedicated correction reviewer without inventory permissions', () => {
    const modules = visibleAdminModules(['stores.read', 'meiping.correction.review']);
    expect(modules.map((item) => item.key)).toContain('meiping');
    expect(modules.map((item) => item.key)).not.toContain('inventory');
  });

  it('does not display file upload or preflight actions for a read-only independent reviewer', () => {
    const html = render(['stores.read', 'meiping.correction.review']);
    expect(html).toContain('美萍纠错建议独立复核');
    expect(html).toContain('授权门店');
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('开始只读预检查');
    expect(html).not.toContain('权限不足');
  });

  it('preserves the original preflight upload for an editor', () => {
    const html = render(['stores.read', 'inventory.receive', 'inventory.stocktake']);
    expect(html).toContain('type="file"');
    expect(html).toContain('开始只读预检查');
  });

  it('hides the Meiping navigation and refuses access without read or edit privileges', () => {
    expect(visibleAdminModules(['stores.read']).map((item) => item.key))
      .not.toContain('meiping');
    expect(render(['stores.read'])).toContain('权限不足');
  });
});
