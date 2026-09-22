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
  const failureNames: Record<string, string> = {
    stores: '门店',
    inventory: '库存',
    rental: '租借',
    fulfillment: '履约',
  };

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
          <span className="badge">运营概览</span>
          <h2>今天需要关注什么</h2>
          <p>汇总当前账号可查看的门店、库存、租借与履约数据。</p>
        </div>
        <div className="hero-note">{me.staff.loginIdentifier}</div>
      </section>

      <section className="panel dashboard-attention">
        <h3>待处理事项</h3>
        {loading && <p>正在读取授权范围内的运营数据…</p>}
        {failures.length > 0 && (
          <p role="alert">
            部分数据暂时无法读取：{failures.map((name) => failureNames[name] ?? name).join('、')}
          </p>
        )}
        <div className="attention-list">
          <Attention
            label="待处理履约"
            value={summary.pendingFulfillmentCount}
            target="fulfillment"
            enabled={permissions.has('fulfillment.read')}
          />
          <Attention
            label="逾期租借"
            value={summary.overdueRentalCount}
            target="rental"
            enabled={permissions.has('rental.read')}
          />
        </div>
      </section>

      <section className="panel">
        <h3>运营概况</h3>
        <div className="dashboard-metrics">
          <Metric label="可见门店" value={summary.storeCount} />
          <Metric label="库存 SKU" value={summary.inventorySkuCount} />
          <Metric label="可用库存" value={summary.inventoryAvailable} />
          <Metric label="进行中租借" value={summary.activeRentalCount} />
        </div>
      </section>
      <section className="panel">
        <h3>工作入口</h3>
        <div className="dashboard-links">
          {modules.slice(1).map((item) => (
            <button
              key={item.key}
              onClick={() => {
                window.location.hash = `#/${item.key}`;
              }}
            >
              <strong>{item.label}</strong>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="dashboard-metric">
      <strong>{value === null ? '—' : value}</strong>
      <span>{label}</span>
      {value === null && <small>暂无可用数据</small>}
    </div>
  );
}

function Attention({
  label,
  value,
  target,
  enabled,
}: {
  label: string;
  value: number | null;
  target: string;
  enabled: boolean;
}) {
  if (!enabled) return null;
  return (
    <button
      className="attention-row"
      onClick={() => {
        window.location.hash = `#/${target}`;
      }}
    >
      <span>{label}</span>
      <strong>{value === null ? '—' : value}</strong>
      <span aria-hidden="true">查看 →</span>
    </button>
  );
}
