import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StaffMeResponse } from '@xiaohai/contracts';
import { DashboardPanel } from './dashboard-panel';

function renderDashboard(permissions: string[]) {
  const me = {
    permissions,
    dataScopes: [],
    staff: { loginIdentifier: 'test.staff' },
  } as unknown as StaffMeResponse;

  return renderToStaticMarkup(<DashboardPanel token="synthetic" me={me} currentStore={null} />);
}

function metricButtonAttributes(html: string, label: string) {
  const button = [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].find((match) =>
    match[2]?.includes(`<span>${label}</span>`),
  );
  expect(button).toBeDefined();
  return button?.[1] ?? '';
}

describe('Store dashboard authorized navigation', () => {
  it('does not expose clickable rental or fulfillment links to inventory-only staff', () => {
    const html = renderDashboard(['stores.read', 'inventory.read']);

    expect(html).toContain('图书查询');
    expect(html).toContain('门店运营');
    expect(html).not.toContain('当前门店预约、借出、归还与逾期处理');
    expect(html).not.toContain('当前门店订单履约、自提核验');
    expect(metricButtonAttributes(html, '待履约')).toContain('disabled=""');
    expect(metricButtonAttributes(html, '进行中租借')).toContain('disabled=""');
    expect(html).toContain('缺少 fulfillment.read');
    expect(html).toContain('缺少 rental.read');
  });

  it('exposes the same rental and fulfillment links as the authorized sidebar', () => {
    const html = renderDashboard(['stores.read', 'rental.read', 'fulfillment.read']);

    expect(html).toContain('当前门店预约、借出、归还与逾期处理');
    expect(html).toContain('当前门店订单履约、自提核验');
    expect(metricButtonAttributes(html, '待履约')).not.toContain('disabled=""');
    expect(metricButtonAttributes(html, '进行中租借')).not.toContain('disabled=""');
  });
});
