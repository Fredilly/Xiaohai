import { useEffect, useMemo, useState } from 'react';
import type { StaffMeResponse } from '@xiaohai/contracts';
import {
  loadHqFulfillment,
  loadHqInventory,
  loadHqRentals,
  loadHqStores,
} from './hq-operations-api';
import { buildHqDashboardSummary, type HqDashboardSummary } from './hq-dashboard-summary';
import type { ModulePreview } from './mock-data';

type Props = {
  token: string;
  me: StaffMeResponse;
  modules: ModulePreview[];
};

const emptySummary: HqDashboardSummary = {
  storeCount: null,
  inventorySkuCount: null,
  inventoryAvailable: null,
  activeRentalCount: null,
  overdueRentalCount: null,
  pendingFulfillmentCount: null,
};

export function HqDashboard({ token, me, modules }: Props) {
  const permissions = useMemo(() => new Set(me.permissions), [me.permissions]);
  const [summary, setSummary] = useState<HqDashboardSummary>(emptySummary);
  const [failures, setFailures] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailures([]);

    async function load() {
      const next: Parameters<typeof buildHqDashboardSummary>[0] = {};
      const errors: string[] = [];
      const tasks: Promise<void>[] = [];

      if (permissions.has('stores.read')) {
        tasks.push(
          loadHqStores(token)
            .then((result) => {
              next.storeCount = result.stores.length;
            })
            .catch(() => {
              errors.push('stores');
            }),
        );
      }

      if (permissions.has('inventory.read')) {
        tasks.push(
          loadHqInventory(token)
            .then((result) => {
              next.inventory = result.items;
            })
            .catch(() => {
              errors.push('inventory');
            }),
        );
      }

      if (permissions.has('rental.read')) {
        tasks.push(
          loadHqRentals(token)
            .then((result) => {
              next.rentals = result.items;
            })
            .catch(() => {
              errors.push('rental');
            }),
        );
      }

      if (permissions.has('fulfillment.read')) {
        tasks.push(
          loadHqFulfillment(token)
            .then((result) => {
              next.fulfillment = result.items;
            })
            .catch(() => {
              errors.push('fulfillment');
            }),
        );
      }

      await Promise.all(tasks);
      if (!cancelled) {
        setSummary(buildHqDashboardSummary(next));
        setFailures(errors);
      }
    }

    void load().finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [permissions, token]);

  return (
    <>
      <section className="hero">
        <div>
          <span className="badge">M20 HQ consolidation</span>
          <h2>M4–M19 production domains → HQ Admin</h2>
          <p>总部视图只汇总当前 Staff 已获服务端授权的真实数据；未授权领域不会伪装成 0。</p>
        </div>
        <div className="hero-note">
          <strong>{me.permissions.length}</strong> permissions ·{' '}
          <strong>{me.dataScopes.length}</strong> scopes
        </div>
      </section>

      <section className="panel">
        <h3>实时运营摘要</h3>
        {loading && <p>正在读取授权范围内的运营数据…</p>}
        {failures.length > 0 && <p>部分模块暂时读取失败：{failures.join(' · ')}</p>}
        <div className="module-grid">
          <Metric label="可见门店" value={summary.storeCount} />
          <Metric label="库存 SKU" value={summary.inventorySkuCount} />
          <Metric label="可用库存" value={summary.inventoryAvailable} />
          <Metric label="进行中租借" value={summary.activeRentalCount} />
          <Metric label="逾期租借" value={summary.overdueRentalCount} />
          <Metric label="待处理履约" value={summary.pendingFulfillmentCount} />
        </div>
      </section>

      <section className="panel">
        <h3>当前 Staff 可见模块</h3>
        <div className="module-grid">
          {modules.slice(1).map((item) => (
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
        </div>
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="empty-state">
      <strong>{value === null ? '—' : value}</strong>
      <span>{label}</span>
      {value === null && <small>未授权或未加载</small>}
    </div>
  );
}
