import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { StaffStore } from '@xiaohai/contracts/stores';
import type {
  GoodsReceipt,
  PurchaseOrder,
  Stocktake,
  StockTransfer,
  Supplier,
} from '@xiaohai/contracts/inventory';
import { loadInventory } from './inventory-api';
import {
  actOnPurchaseOrder,
  actOnStocktake,
  actOnStockTransfer,
  countStocktake,
  createGoodsReceipt,
  createPurchaseOrder,
  createStocktake,
  createStockTransfer,
  loadInventoryAlerts,
  loadInventoryTransactions,
  loadSuppliers,
  postGoodsReceipt,
} from './operations-api';

type Balance = Awaited<ReturnType<typeof loadInventory>>['items'][number];
type Alert = Awaited<ReturnType<typeof loadInventoryAlerts>>['alerts'][number];
type Transaction = Awaited<ReturnType<typeof loadInventoryTransactions>>['transactions'][number];

type Props = {
  token: string;
  storeId: string;
  stores: StaffStore[];
  permissions: string[];
};

export function OperationsPanel({ token, storeId, stores, permissions }: Props) {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [receipt, setReceipt] = useState<GoodsReceipt | null>(null);
  const [stocktake, setStocktake] = useState<Stocktake | null>(null);
  const [transfer, setTransfer] = useState<StockTransfer | null>(null);
  const [status, setStatus] = useState('正在加载门店运营数据…');
  const [busy, setBusy] = useState(false);

  const canRead = permissions.includes('inventory.read');
  const canProcure = permissions.includes('procurement.manage');
  const canReceive = permissions.includes('inventory.receive');
  const canStocktake = permissions.includes('inventory.stocktake');
  const canTransfer = permissions.includes('inventory.transfer');

  const refresh = useCallback(async () => {
    try {
      const [inventory, lowStock, history, supplierData] = await Promise.all([
        canRead ? loadInventory(token, storeId) : Promise.resolve({ items: [] }),
        canRead ? loadInventoryAlerts(token, storeId) : Promise.resolve({ alerts: [] }),
        canRead ? loadInventoryTransactions(token, storeId) : Promise.resolve({ transactions: [] }),
        canProcure ? loadSuppliers(token) : Promise.resolve({ suppliers: [] }),
      ]);
      setBalances(inventory.items);
      setAlerts(lowStock.alerts);
      setTransactions(history.transactions.slice(0, 20));
      setSuppliers(supplierData.suppliers.filter((item) => item.status === 'ACTIVE'));
      setStatus('门店运营数据已加载');
    } catch (error) {
      setStatus(error instanceof Error ? `加载失败：${error.message}` : '加载失败');
    }
  }, [canProcure, canRead, storeId, token]);

  useEffect(() => {
    setPurchaseOrder(null);
    setReceipt(null);
    setStocktake(null);
    setTransfer(null);
    void refresh();
  }, [refresh]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? `操作失败：${error.message}` : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  async function createPo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const supplierId = text(data, 'supplierId');
    const skuId = text(data, 'skuId');
    const quantity = Number(data.get('quantity'));
    const unitCost = text(data, 'unitCostMinor');
    const notes = text(data, 'notes');
    if (!supplierId || !skuId || !Number.isInteger(quantity) || quantity <= 0) return;
    await run(async () => {
      const created = await createPurchaseOrder(token, {
        supplierId,
        storeId,
        notes: notes || null,
        items: [
          {
            skuId,
            quantity,
            unitCostMinor: unitCost ? Number(unitCost) : null,
          },
        ],
      });
      setPurchaseOrder(created);
      setReceipt(null);
      setStatus(`采购单 ${created.orderNumber} 已创建`);
      form.reset();
    });
  }

  const purchaseAction = (action: 'SUBMIT' | 'CANCEL') =>
    run(async () => {
      if (!purchaseOrder) return;
      const updated = await actOnPurchaseOrder(token, purchaseOrder.id, action);
      setPurchaseOrder({ ...purchaseOrder, ...updated });
      setStatus(`采购单已${action === 'SUBMIT' ? '提交' : '取消'}`);
    });

  const receiveOutstanding = () =>
    run(async () => {
      if (!purchaseOrder) return;
      const items = purchaseOrder.items
        .map((item) => ({
          purchaseOrderItemId: item.id,
          quantity: item.orderedQuantity - item.receivedQuantity,
        }))
        .filter((item) => item.quantity > 0);
      if (!items.length) throw new Error('NO_OUTSTANDING_ITEMS');
      const created = await createGoodsReceipt(token, {
        purchaseOrderId: purchaseOrder.id,
        items,
      });
      setReceipt(created);
      setStatus(`收货单 ${created.receiptNumber} 已创建，待过账`);
    });

  const postReceipt = () =>
    run(async () => {
      if (!receipt) return;
      const posted = await postGoodsReceipt(token, receipt.id);
      setReceipt({ ...receipt, ...posted });
      setStatus(`收货单 ${receipt.receiptNumber} 已过账，库存已更新`);
    });

  async function createCount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const skuId = text(data, 'skuId');
    if (!skuId) return;
    await run(async () => {
      const created = await createStocktake(token, { storeId, skuIds: [skuId] });
      setStocktake(created);
      setStatus(`盘点单 ${created.stocktakeNumber} 已创建`);
      form.reset();
    });
  }

  const stocktakeAction = (action: 'START' | 'REVIEW' | 'POST' | 'CANCEL') =>
    run(async () => {
      if (!stocktake) return;
      const updated = await actOnStocktake(token, stocktake.id, action);
      setStocktake({ ...stocktake, ...updated });
      setStatus(`盘点单状态已更新为 ${updated.status}`);
    });

  async function saveCount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stocktake) return;
    const data = new FormData(event.currentTarget);
    const countedQuantity = Number(data.get('countedQuantity'));
    const item = stocktake.items[0];
    if (!item || !Number.isInteger(countedQuantity) || countedQuantity < 0) return;
    await run(async () => {
      const updated = await countStocktake(token, stocktake.id, {
        items: [{ skuId: item.skuId, countedQuantity }],
      });
      setStocktake({
        ...stocktake,
        ...updated,
        items: stocktake.items.map((row) =>
          row.skuId === item.skuId ? { ...row, countedQuantity } : row,
        ),
      });
      setStatus('实盘数量已保存');
    });
  }

  async function createTransferDoc(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const destinationStoreId = text(data, 'destinationStoreId');
    const skuId = text(data, 'skuId');
    const quantity = Number(data.get('quantity'));
    if (!destinationStoreId || !skuId || !Number.isInteger(quantity) || quantity <= 0) return;
    await run(async () => {
      const created = await createStockTransfer(token, {
        sourceStoreId: storeId,
        destinationStoreId,
        items: [{ skuId, quantity }],
      });
      setTransfer(created);
      setStatus(`调拨单 ${created.transferNumber} 已创建`);
      form.reset();
    });
  }

  const transferAction = (action: 'SUBMIT' | 'DISPATCH' | 'RECEIVE' | 'CANCEL') =>
    run(async () => {
      if (!transfer) return;
      const updated = await actOnStockTransfer(token, transfer.id, action);
      setTransfer({ ...transfer, ...updated });
      setStatus(`调拨单状态已更新为 ${updated.status}`);
    });

  const otherStores = stores.filter((store) => store.id !== storeId);

  return (
    <section className="panel operations-panel">
      <span className="tag">M19 Manager Operations</span>
      <h2>采购、盘点与调拨</h2>
      <p>
        所有写操作继续复用 M14 Staff API。页面中的门店只是操作上下文，服务端仍按 RBAC + Data Scope
        再次校验。
      </p>

      {canRead ? (
        <div className="operations-grid">
          <section className="ops-card">
            <h3>低库存提醒</h3>
            {alerts.length ? (
              alerts.map((item) => (
                <div className="compact-row" key={item.skuId}>
                  <span>{item.skuName}</span>
                  <strong>{item.available}</strong>
                  <small>{item.severity === 'OUT_OF_STOCK' ? '缺货' : '低库存'}</small>
                </div>
              ))
            ) : (
              <p>当前阈值内没有低库存项目。</p>
            )}
          </section>
          <section className="ops-card">
            <h3>最近库存流水</h3>
            {transactions.slice(0, 8).map((item) => (
              <div className="compact-row" key={item.id}>
                <span>{item.transactionType}</span>
                <strong>{item.quantityDelta > 0 ? `+${item.quantityDelta}` : item.quantityDelta}</strong>
                <small>{new Date(item.createdAt).toLocaleString()}</small>
              </div>
            ))}
            {!transactions.length && <p>暂无库存流水。</p>}
          </section>
        </div>
      ) : (
        <p className="permission-note">缺少 inventory.read，库存提醒与流水不会加载。</p>
      )}

      {canProcure && canRead && (
        <section className="ops-card ops-workflow">
          <h3>采购与收货</h3>
          <form className="ops-form" onSubmit={(event) => void createPo(event)}>
            <select name="supplierId" required defaultValue="">
              <option value="" disabled>选择供应商</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
              ))}
            </select>
            <select name="skuId" required defaultValue="">
              <option value="" disabled>选择 SKU</option>
              {balances.map((item) => (
                <option key={item.skuId} value={item.skuId}>{item.skuName} · {item.skuCode}</option>
              ))}
            </select>
            <input name="quantity" type="number" min="1" step="1" placeholder="采购数量" required />
            <input name="unitCostMinor" type="number" min="0" step="1" placeholder="单价（分，可选）" />
            <input name="notes" maxLength={500} placeholder="备注（可选）" />
            <button disabled={busy || !suppliers.length || !balances.length}>创建采购单</button>
          </form>
          {purchaseOrder && (
            <div className="workflow-state">
              <strong>{purchaseOrder.orderNumber}</strong>
              <span>{purchaseOrder.status}</span>
              {purchaseOrder.status === 'DRAFT' && (
                <>
                  <button disabled={busy} onClick={() => void purchaseAction('SUBMIT')}>提交</button>
                  <button disabled={busy} onClick={() => void purchaseAction('CANCEL')}>取消</button>
                </>
              )}
              {(purchaseOrder.status === 'SUBMITTED' || purchaseOrder.status === 'PARTIALLY_RECEIVED') && canReceive && !receipt && (
                <button disabled={busy} onClick={() => void receiveOutstanding()}>创建剩余数量收货单</button>
              )}
              {receipt && receipt.status === 'DRAFT' && canReceive && (
                <button disabled={busy} onClick={() => void postReceipt()}>过账 {receipt.receiptNumber}</button>
              )}
              {receipt?.status === 'POSTED' && <span>收货已过账</span>}
            </div>
          )}
        </section>
      )}

      {canStocktake && canRead && (
        <section className="ops-card ops-workflow">
          <h3>库存盘点</h3>
          <form className="ops-form compact-form" onSubmit={(event) => void createCount(event)}>
            <select name="skuId" required defaultValue="">
              <option value="" disabled>选择盘点 SKU</option>
              {balances.map((item) => (
                <option key={item.skuId} value={item.skuId}>{item.skuName} · 账面 {item.onHand}</option>
              ))}
            </select>
            <button disabled={busy || !balances.length}>创建盘点单</button>
          </form>
          {stocktake && (
            <div className="workflow-state">
              <strong>{stocktake.stocktakeNumber}</strong>
              <span>{stocktake.status}</span>
              {stocktake.status === 'DRAFT' && (
                <>
                  <button disabled={busy} onClick={() => void stocktakeAction('START')}>开始盘点</button>
                  <button disabled={busy} onClick={() => void stocktakeAction('CANCEL')}>取消</button>
                </>
              )}
              {stocktake.status === 'COUNTING' && (
                <form className="inline-count" onSubmit={(event) => void saveCount(event)}>
                  <input name="countedQuantity" type="number" min="0" step="1" placeholder="实盘数量" required />
                  <button disabled={busy}>保存数量</button>
                </form>
              )}
              {stocktake.status === 'COUNTING' && stocktake.items.every((item) => item.countedQuantity !== null) && (
                <button disabled={busy} onClick={() => void stocktakeAction('REVIEW')}>复核</button>
              )}
              {stocktake.status === 'REVIEWED' && (
                <button disabled={busy} onClick={() => void stocktakeAction('POST')}>过账差异</button>
              )}
            </div>
          )}
        </section>
      )}

      {canTransfer && canRead && (
        <section className="ops-card ops-workflow">
          <h3>门店调拨</h3>
          <form className="ops-form compact-form" onSubmit={(event) => void createTransferDoc(event)}>
            <select name="destinationStoreId" required defaultValue="">
              <option value="" disabled>选择目标门店</option>
              {otherStores.map((store) => (
                <option key={store.id} value={store.id}>{store.name} · {store.city}</option>
              ))}
            </select>
            <select name="skuId" required defaultValue="">
              <option value="" disabled>选择 SKU</option>
              {balances.map((item) => (
                <option key={item.skuId} value={item.skuId}>{item.skuName} · 可用 {item.available}</option>
              ))}
            </select>
            <input name="quantity" type="number" min="1" step="1" placeholder="调拨数量" required />
            <button disabled={busy || !otherStores.length || !balances.length}>创建调拨单</button>
          </form>
          {transfer && (
            <div className="workflow-state">
              <strong>{transfer.transferNumber}</strong>
              <span>{transfer.status}</span>
              {transfer.status === 'DRAFT' && (
                <>
                  <button disabled={busy} onClick={() => void transferAction('SUBMIT')}>提交</button>
                  <button disabled={busy} onClick={() => void transferAction('CANCEL')}>取消</button>
                </>
              )}
              {transfer.status === 'SUBMITTED' && (
                <button disabled={busy} onClick={() => void transferAction('DISPATCH')}>确认发出</button>
              )}
              {transfer.status === 'IN_TRANSIT' && (
                <button disabled={busy} onClick={() => void transferAction('RECEIVE')}>目标门店确认收货</button>
              )}
            </div>
          )}
        </section>
      )}

      {!canProcure && !canStocktake && !canTransfer && (
        <p className="permission-note">当前 Staff Account 没有采购、盘点或调拨权限。</p>
      )}
      <p role="status">{status}</p>
    </section>
  );
}

function text(data: FormData, field: string) {
  const value = data.get(field);
  return typeof value === 'string' ? value.trim() : '';
}
