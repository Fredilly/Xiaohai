import { useEffect, useMemo, useState } from 'react';
import type { StaffMeResponse } from '@xiaohai/contracts';
import type { StaffStore } from '@xiaohai/contracts/stores';
import { loadFulfillment } from './fulfillment-api';
import { loadInventory } from './inventory-api';
import { loadInventoryAlerts } from './operations-api';
import { loadRentals } from './rental-api';
import { summarizeDashboard, type DashboardSummary } from './dashboard-summary';

type Props = {
  token: string;
  me: StaffMeResponse;
  currentStore: StaffStore;
  stores: StaffStore[];
};

const emptySummary: DashboardSummary = {
  inventorySkus: null,
  availableUnits: null,
  lowStock: null,
  outOfStock: null,
  openFulfillment: null,
  pickupWaiting: null,
  deliveryActive: null,
  activeRentals: null,
  overdueRentals: null,
};

export function ManagerPanel({ token, me, currentStore, stores }: Props) {
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary);
  const [status, setStatus] = useState('正在加载店长运营摘要…');

  const canInventory = me.permissions.includes('inventory.read');
  const canFulfillment = me.permissions.includes('fulfillment.read');
  const canRental = me.permissions.includes('rental.read');

  useEffect(() => {
    let active = true;
    setStatus('正在加载店长运营摘要…');
    void Promise.allSettled([
      canInventory ? loadInventory(token, currentStore.id) : Promise.resolve(null),
      canInventory ? loadInventoryAlerts(token, currentStore.id) : Promise.resolve(null),
      canFulfillment ? loadFulfillment(token, currentStore.id) : Promise.resolve(null),
      canRental ? loadRentals(token, currentStore.id) : Promise.resolve(null),
    ]).then((results) => {
      if (!active) return;
      const [inventory, alerts, fulfillment, rentals] = results;
      setSummary(
        summarizeDashboard({
          inventory: inventory.status === 'fulfilled' ? inventory.value : null,
          alerts: alerts.status === 'fulfilled' ? alerts.value : null,
          fulfillment: fulfillment.status === 'fulfilled' ? fulfillment.value : null,
          rentals: rentals.status === 'fulfilled' ? rentals.value : null,
        }),
      );
      const failed = results.filter((result) => result.status === 'rejected').length;
      setStatus(failed ? `部分店长报表加载失败（${failed} 项）` : '店长运营摘要已更新');
    });

    return () => {
      active = false;
    };
  }, [canFulfillment, canInventory, canRental, currentStore.id, token]);

  const metrics = useMemo(
    () => [
      {
        label: '可售库存',
        value: summary.availableUnits,
        detail:
          summary.inventorySkus === null
            ? '缺少 inventory.read'
            : `${summary.inventorySkus} 个 SKU`,
        target: 'inventory',
      },
      {
        label: '低库存',
        value: summary.lowStock,
        detail:
          summary.outOfStock === null ? '缺少 inventory.read' : `其中缺货 ${summary.outOfStock}`,
        target: 'operations',
      },
      {
        label: '待履约',
        value: summary.openFulfillment,
        detail:
          summary.pickupWaiting === null || summary.deliveryActive === null
            ? '缺少 fulfillment.read'
            : `自提 ${summary.pickupWaiting} · 配送 ${summary.deliveryActive}`,
        target: 'orders',
      },
      {
        label: '进行中租借',
        value: summary.activeRentals,
        detail:
          summary.overdueRentals === null ? '缺少 rental.read' : `逾期 ${summary.overdueRentals}`,
        target: 'rental',
      },
    ],
    [summary],
  );

  return (
    <section className="panel operations-panel">
      <span className="tag">M19 Store Manager</span>
      <h2>{currentStore.name} · 店长视图</h2>
      <p>
        这里仅汇总当前员工已经被服务端授权的数据。门店选择、页面可见性与按钮状态都不会扩大 Staff
        Session 的 RBAC + Data Scope。
      </p>

      <p className="dashboard-status" role="status">
        {status}
      </p>

      <section className="metric-grid" aria-label="店长实时运营摘要">
        {metrics.map((metric) => (
          <button
            key={metric.label}
            onClick={() => {
              window.location.hash = `#/${metric.target}`;
            }}
          >
            <span>{metric.label}</span>
            <strong>{metric.value === null ? '—' : metric.value}</strong>
            <small>{metric.detail}</small>
          </button>
        ))}
      </section>

      <div className="operations-grid">
        <section className="ops-card">
          <h3>当前 Staff Context</h3>
          <div className="compact-row">
            <span>登录账号</span>
            <strong>{me.staff.loginIdentifier}</strong>
            <small>当前已认证 Staff Session</small>
          </div>
          <div className="compact-row">
            <span>权限数量</span>
            <strong>{me.permissions.length}</strong>
            <small>来自服务端角色授权</small>
          </div>
          <div className="compact-row">
            <span>Data Scope</span>
            <strong>{me.dataScopes.length}</strong>
            <small>
              {me.dataScopes.length
                ? me.dataScopes.map((scope) => scope.type).join(' · ')
                : '暂无授权范围'}
            </small>
          </div>
        </section>

        <section className="ops-card">
          <h3>门店运营范围</h3>
          <div className="compact-row">
            <span>可访问门店</span>
            <strong>{stores.length}</strong>
            <small>由 GET /api/v1/staff/stores 返回</small>
          </div>
          <div className="compact-row">
            <span>当前门店</span>
            <strong>{currentStore.code}</strong>
            <small>{currentStore.city}</small>
          </div>
          <div className="compact-row">
            <span>门店状态</span>
            <strong>{currentStore.operationalStatus}</strong>
            <small>{currentStore.region.name}</small>
          </div>
        </section>
      </div>

      <section className="notice">
        <strong>员工管理边界</strong>
        <p>
          M19 不新增跨员工账号目录、角色编辑或 Staff 生命周期管理接口。当前后端只有本人 Staff
          Session/权限/Data Scope 与门店授权上下文；为了避免把账号信息暴露给过宽的
          stores.read/stores.manage
          权限，本阶段只展示当前登录员工的运营上下文。完整员工目录、角色/RBAC
          编辑与总部级人员管理留在 M20。
        </p>
      </section>
    </section>
  );
}
