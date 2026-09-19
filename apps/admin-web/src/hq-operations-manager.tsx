import { useEffect, useMemo, useState } from 'react';
import type { StaffMeResponse } from '@xiaohai/contracts';
import { HqInventoryWorkflows } from './hq-inventory-workflows';
import {
  loadHqFulfillment,
  loadHqInventory,
  loadHqInventoryAlerts,
  loadHqInventoryTransactions,
  loadHqRentals,
  loadHqStores,
  loadHqSuppliers,
} from './hq-operations-api';

export type HqOperationsMode = 'stores' | 'inventory' | 'rental' | 'fulfillment';

type StoresResult = Awaited<ReturnType<typeof loadHqStores>>;
type InventoryResult = Awaited<ReturnType<typeof loadHqInventory>>;
type AlertsResult = Awaited<ReturnType<typeof loadHqInventoryAlerts>>;
type TransactionsResult = Awaited<ReturnType<typeof loadHqInventoryTransactions>>;
type SuppliersResult = Awaited<ReturnType<typeof loadHqSuppliers>>;
type RentalsResult = Awaited<ReturnType<typeof loadHqRentals>>;
type FulfillmentResult = Awaited<ReturnType<typeof loadHqFulfillment>>;

const modeMeta: Record<
  HqOperationsMode,
  { title: string; description: string; permission: string }
> = {
  stores: {
    title: '组织 / 门店',
    description: '读取服务端授权范围内的区域与门店运营上下文。',
    permission: 'stores.read',
  },
  inventory: {
    title: '库存 / 进销存',
    description: '查看库存余额、低库存预警、库存流水，并在授权范围内执行采购、收货、盘点和调拨。',
    permission: 'inventory.read',
  },
  rental: {
    title: '租借',
    description: '查看服务端 Data Scope 内的预约、借出、归还和逾期记录。',
    permission: 'rental.read',
  },
  fulfillment: {
    title: '自提 / 配送',
    description: '查看订单履约、自提和配送状态。',
    permission: 'fulfillment.read',
  },
};

export function HqOperationsManager({
  token,
  me,
  mode,
}: {
  token: string;
  me: StaffMeResponse;
  mode: HqOperationsMode;
}) {
  const permissions = useMemo(() => new Set(me.permissions), [me.permissions]);
  const meta = modeMeta[mode];
  const allowed = permissions.has(meta.permission);
  const canReadStores = permissions.has('stores.read');
  const canReadSuppliers = permissions.has('procurement.manage');
  const [stores, setStores] = useState<StoresResult | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [inventory, setInventory] = useState<InventoryResult | null>(null);
  const [alerts, setAlerts] = useState<AlertsResult | null>(null);
  const [transactions, setTransactions] = useState<TransactionsResult | null>(null);
  const [suppliers, setSuppliers] = useState<SuppliersResult | null>(null);
  const [rentals, setRentals] = useState<RentalsResult | null>(null);
  const [fulfillment, setFulfillment] = useState<FulfillmentResult | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!canReadStores) {
      setStores(null);
      setSelectedStoreId('');
      return;
    }
    let cancelled = false;
    void loadHqStores(token)
      .then((result) => {
        if (!cancelled) setStores(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : 'STORE_LOAD_FAILED');
      });
    return () => {
      cancelled = true;
    };
  }, [canReadStores, token]);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    setStatus('');

    async function load() {
      if (mode === 'stores') return;
      if (mode === 'inventory') {
        const inventoryResult = await loadHqInventory(token, selectedStoreId || undefined);
        if (cancelled) return;
        setInventory(inventoryResult);
        if (selectedStoreId) {
          const [alertsResult, transactionsResult] = await Promise.all([
            loadHqInventoryAlerts(token, selectedStoreId),
            loadHqInventoryTransactions(token, selectedStoreId),
          ]);
          if (!cancelled) {
            setAlerts(alertsResult);
            setTransactions(transactionsResult);
          }
        } else {
          setAlerts(null);
          setTransactions(null);
        }
        if (canReadSuppliers) {
          const suppliersResult = await loadHqSuppliers(token);
          if (!cancelled) setSuppliers(suppliersResult);
        } else {
          setSuppliers(null);
        }
        return;
      }
      if (mode === 'rental') {
        const result = await loadHqRentals(token, selectedStoreId || undefined);
        if (!cancelled) setRentals(result);
        return;
      }
      const result = await loadHqFulfillment(token, selectedStoreId || undefined);
      if (!cancelled) setFulfillment(result);
    }

    void load()
      .catch((error: unknown) => {
        if (!cancelled)
          setStatus(error instanceof Error ? error.message : 'HQ_OPERATIONS_LOAD_FAILED');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [allowed, canReadSuppliers, mode, refreshKey, selectedStoreId, token]);

  if (!allowed) {
    return (
      <section className="panel preview">
        <span className="badge">无当前权限</span>
        <h2>{meta.title}</h2>
        <p>当前 Staff Session 缺少 {meta.permission}。前端不会尝试绕过服务端 RBAC。</p>
      </section>
    );
  }

  return (
    <>
      <section className="panel">
        <span className="badge">M20 · REAL API</span>
        <h2>{meta.title}</h2>
        <p>{meta.description}</p>
        <div className="context">
          <p>服务端 RBAC + Data Scope 仍是最终授权边界。</p>
          {stores && mode !== 'stores' && (
            <label>
              门店筛选
              <select
                value={selectedStoreId}
                onChange={(event) => setSelectedStoreId(event.target.value)}
              >
                <option value="">全部授权范围</option>
                {stores.stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name} · {store.city}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!canReadStores && mode !== 'stores' && (
            <p>未授予 stores.read，当前按后端 Data Scope 汇总。</p>
          )}
          {loading && <p>加载中…</p>}
          {status && <p>加载失败：{status}</p>}
        </div>
      </section>
      {mode === 'stores' && <StoresView stores={stores} />}
      {mode === 'inventory' && (
        <>
          <InventoryView
            inventory={inventory}
            alerts={alerts}
            transactions={transactions}
            suppliers={suppliers}
            selectedStoreId={selectedStoreId}
            canReadSuppliers={canReadSuppliers}
          />
          <HqInventoryWorkflows
            key={selectedStoreId || 'all'}
            token={token}
            me={me}
            storeId={selectedStoreId}
            stores={stores?.stores ?? []}
            balances={inventory?.items ?? []}
            suppliers={suppliers?.suppliers ?? []}
            onSupplierCreated={(supplier) =>
              setSuppliers((current) => ({
                suppliers: [...(current?.suppliers ?? []), supplier],
              }))
            }
            onRefresh={() => setRefreshKey((value) => value + 1)}
          />
        </>
      )}
      {mode === 'rental' && <RentalView rentals={rentals} />}
      {mode === 'fulfillment' && <FulfillmentView fulfillment={fulfillment} />}
    </>
  );
}

function StoresView({ stores }: { stores: StoresResult | null }) {
  return (
    <section className="panel">
      <h3>授权门店</h3>
      <div className="module-grid">
        {stores?.stores.map((store) => (
          <div key={store.id} className="empty-state">
            <strong>{store.name}</strong>
            <span>
              {store.code} · {store.region.name} · {store.city}
            </span>
            <span>
              {store.operationalStatus}
              {store.franchisee ? ` · ${store.franchisee.name}` : ' · 直营网点'}
            </span>
          </div>
        ))}
      </div>
      {stores?.stores.length === 0 && <p>当前 Data Scope 下没有可见门店。</p>}
    </section>
  );
}

function InventoryView({
  inventory,
  alerts,
  transactions,
  suppliers,
  selectedStoreId,
  canReadSuppliers,
}: {
  inventory: InventoryResult | null;
  alerts: AlertsResult | null;
  transactions: TransactionsResult | null;
  suppliers: SuppliersResult | null;
  selectedStoreId: string;
  canReadSuppliers: boolean;
}) {
  const available = inventory?.items.reduce((sum, item) => sum + item.available, 0) ?? 0;
  return (
    <>
      <section className="panel">
        <h3>库存余额</h3>
        <p>
          SKU：{inventory?.items.length ?? 0} · 可用库存：{available}
        </p>
        <div className="module-grid">
          {inventory?.items.slice(0, 24).map((item) => (
            <div key={`${item.storeId}:${item.skuId}`} className="empty-state">
              <strong>{item.skuName}</strong>
              <span>{item.skuCode}</span>
              <span>
                on hand {item.onHand} · reserved {item.reserved} · available {item.available}
              </span>
            </div>
          ))}
        </div>
      </section>
      {selectedStoreId && (
        <section className="panel">
          <h3>门店预警与库存流水</h3>
          <p>低库存 / 缺货：{alerts?.alerts.length ?? 0}</p>
          <p>最近库存流水：{transactions?.transactions.length ?? 0}</p>
        </section>
      )}
      <section className="panel">
        <h3>采购上下文</h3>
        {canReadSuppliers ? (
          <p>供应商：{suppliers?.suppliers.length ?? 0}（写操作仍由服务端权限和 Data Scope 保护）</p>
        ) : (
          <p>当前 Staff 没有 procurement.manage，不加载供应商或采购能力。</p>
        )}
      </section>
    </>
  );
}

function RentalView({ rentals }: { rentals: RentalsResult | null }) {
  return (
    <section className="panel">
      <h3>租借记录</h3>
      <div className="module-grid">
        {rentals?.items.slice(0, 30).map((rental) => (
          <div key={rental.id} className="empty-state">
            <strong>{rental.rentalNumber}</strong>
            <span>
              {rental.storeName} · {rental.status}
            </span>
            <span>
              {rental.items.length} items{rental.isOverdue ? ' · OVERDUE' : ''}
            </span>
          </div>
        ))}
      </div>
      {rentals?.items.length === 0 && <p>当前范围没有租借记录。</p>}
    </section>
  );
}

function FulfillmentView({ fulfillment }: { fulfillment: FulfillmentResult | null }) {
  return (
    <section className="panel">
      <h3>订单履约</h3>
      <div className="module-grid">
        {fulfillment?.items.slice(0, 30).map((item) => (
          <div key={item.orderId} className="empty-state">
            <strong>{item.orderNumber}</strong>
            <span>
              {item.store.name} · {item.method} · {item.orderStatus}
            </span>
            <span>
              {item.pickup ? `pickup ${item.pickup.status}` : ''}
              {item.delivery ? `delivery ${item.delivery.status}` : ''}
            </span>
          </div>
        ))}
      </div>
      {fulfillment?.items.length === 0 && <p>当前范围没有履约记录。</p>}
    </section>
  );
}
