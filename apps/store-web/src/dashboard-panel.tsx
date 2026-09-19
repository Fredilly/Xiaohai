import { useEffect, useMemo, useState } from 'react';
import type { StaffMeResponse } from '@xiaohai/contracts';
import type { StaffStore } from '@xiaohai/contracts/stores';
import { loadFulfillment } from './fulfillment-api';
import { loadInventory } from './inventory-api';
import { loadInventoryAlerts } from './operations-api';
import { loadRentals } from './rental-api';
import { storeModules } from './mock-data';
import { summarizeDashboard, type DashboardSummary } from './dashboard-summary';

type Props = {
  token: string;
  me: StaffMeResponse;
  currentStore: StaffStore | null;
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

export function DashboardPanel({ token, me, currentStore }: Props) {
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary);
  const [status, setStatus] = useState('请选择可访问门店');

  const canInventory = me.permissions.includes('inventory.read');
  const canFulfillment = me.permissions.includes('fulfillment.read');
  const canRental = me.permissions.includes('rental.read');
  const canManageStore = me.permissions.includes('stores.manage');

  useEffect(() => {
    if (!currentStore) {
      setSummary(emptySummary);
      setStatus('当前账号没有可访问门店');
      return;
    }

    let active = true;
    setStatus('正在加载实时运营摘要…');
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
      setStatus(failed ? `部分运营数据加载失败（${failed} 项）` : '实时运营摘要已更新');
    });

    return () => {
      active = false;
    };
  }, [canFulfillment, canInventory, canRental, currentStore, token]);

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

  const visibleModules = useMemo(
    () => storeModules.slice(1).filter((item) => item.key !== 'manager' || canManageStore),
    [canManageStore],
  );

  return (
    <>
      <section className="hero">
        <span className="tag">M19 Store Web</span>
        <h2>{currentStore ? `${currentStore.name} 工作台` : '今天从这里开始门店工作'}</h2>
        <p>
          {currentStore
            ? `${currentStore.city} · ${currentStore.addressLine}`
            : '请先确认当前账号具有 stores.read 权限和可访问门店范围。'}
        </p>
        <div className="scope">
          服务端 Data Scope：
          {me.dataScopes.length
            ? me.dataScopes.map((item) => item.type).join(' · ')
            : '暂无授权范围'}
        </div>
      </section>

      <p className="dashboard-status" role="status">
        {status}
      </p>

      <section className="metric-grid" aria-label="门店实时运营摘要">
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

      <section className="quick-grid">
        {visibleModules.map((item) => (
          <button
            key={item.key}
            onClick={() => {
              window.location.hash = `#/${item.key}`;
            }}
          >
            <strong>{item.label}</strong>
            <span>{item.description}</span>
            <em>{item.status}</em>
          </button>
        ))}
      </section>

      <section className="notice">
        <strong>安全边界</strong>
        <p>
          首页数据来自现有 M14–M16 Staff API，并按当前门店查询。前端门店选择器只决定页面上下文，
          每个请求仍由 API 根据 Staff Session + RBAC + Data Scope 校验。
        </p>
      </section>
    </>
  );
}
