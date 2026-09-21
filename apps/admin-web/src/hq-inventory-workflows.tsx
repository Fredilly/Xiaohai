import { useState, type FormEvent } from 'react';
import type { StaffMeResponse } from '@xiaohai/contracts';
import type {
  GoodsReceipt,
  PurchaseOrder,
  Stocktake,
  StockTransfer,
  Supplier,
} from '@xiaohai/contracts/inventory';
import type { StaffStore } from '@xiaohai/contracts/stores';
import {
  actOnHqPurchaseOrder,
  actOnHqStocktake,
  actOnHqStockTransfer,
  countHqStocktake,
  createHqGoodsReceipt,
  createHqPurchaseOrder,
  createHqStocktake,
  createHqStockTransfer,
  createHqSupplier,
  postHqGoodsReceipt,
} from './hq-operations-api';

type Balance = {
  skuId: string;
  skuCode: string;
  skuName: string;
  onHand: number;
};

type Props = {
  token: string;
  me: StaffMeResponse;
  storeId: string;
  stores: StaffStore[];
  balances: Balance[];
  suppliers: Supplier[];
  onSupplierCreated: (supplier: Supplier) => void;
  onRefresh: () => void;
};

export function HqInventoryWorkflows({
  token,
  me,
  storeId,
  stores,
  balances,
  suppliers,
  onSupplierCreated,
  onRefresh,
}: Props) {
  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [receipt, setReceipt] = useState<GoodsReceipt | null>(null);
  const [stocktake, setStocktake] = useState<Stocktake | null>(null);
  const [transfer, setTransfer] = useState<StockTransfer | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const permissions = new Set(me.permissions);
  const canProcure = permissions.has('procurement.manage');
  const canReceive = permissions.has('inventory.receive');
  const canStocktake = permissions.has('inventory.stocktake');
  const canTransfer = permissions.has('inventory.transfer');
  const hasGlobalScope = me.dataScopes.some((scope) => scope.type === 'GLOBAL');

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setStatus('');
    try {
      await work();
      onRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? `操作失败：${error.message}` : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  async function createSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const code = text(data, 'code');
    const name = text(data, 'name');
    if (!code || !name) return;
    await run(async () => {
      const supplier = await createHqSupplier(token, {
        code,
        name,
        contactName: nullableText(data, 'contactName'),
        email: nullableText(data, 'email'),
        phone: nullableText(data, 'phone'),
      });
      onSupplierCreated(supplier);
      form.reset();
      setStatus(`供应商 ${supplier.name} 已创建`);
    });
  }

  async function createPurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const supplierId = text(data, 'supplierId');
    const skuId = text(data, 'skuId');
    const quantity = Number(data.get('quantity'));
    const unitCostMinor = text(data, 'unitCostMinor');
    if (!storeId || !supplierId || !skuId || !Number.isInteger(quantity) || quantity <= 0) return;
    await run(async () => {
      const created = await createHqPurchaseOrder(token, {
        storeId,
        supplierId,
        notes: nullableText(data, 'notes'),
        items: [
          {
            skuId,
            quantity,
            unitCostMinor: unitCostMinor ? Number(unitCostMinor) : null,
          },
        ],
      });
      setPurchaseOrder(created);
      setReceipt(null);
      form.reset();
      setStatus(`采购单 ${created.orderNumber} 已创建`);
    });
  }

  function purchaseAction(action: 'SUBMIT' | 'CANCEL') {
    void run(async () => {
      if (!purchaseOrder) return;
      const updated = await actOnHqPurchaseOrder(token, purchaseOrder.id, action);
      setPurchaseOrder({ ...purchaseOrder, ...updated });
      setStatus(`采购单状态：${updated.status}`);
    });
  }

  function receiveOutstanding() {
    void run(async () => {
      if (!purchaseOrder) return;
      const items = purchaseOrder.items
        .map((item) => ({
          purchaseOrderItemId: item.id,
          quantity: item.orderedQuantity - item.receivedQuantity,
        }))
        .filter((item) => item.quantity > 0);
      if (!items.length) throw new Error('NO_OUTSTANDING_ITEMS');
      const created = await createHqGoodsReceipt(token, {
        purchaseOrderId: purchaseOrder.id,
        items,
      });
      setReceipt(created);
      setStatus(`收货单 ${created.receiptNumber} 已创建`);
    });
  }

  function postReceipt() {
    void run(async () => {
      if (!receipt) return;
      const updated = await postHqGoodsReceipt(token, receipt.id);
      setReceipt({ ...receipt, ...updated });
      setStatus(`收货单 ${receipt.receiptNumber} 已过账`);
    });
  }

  async function createCount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const skuId = text(data, 'skuId');
    if (!storeId || !skuId) return;
    await run(async () => {
      const created = await createHqStocktake(token, { storeId, skuIds: [skuId] });
      setStocktake(created);
      form.reset();
      setStatus(`盘点单 ${created.stocktakeNumber} 已创建`);
    });
  }

  function stocktakeAction(action: 'START' | 'REVIEW' | 'POST' | 'CANCEL') {
    void run(async () => {
      if (!stocktake) return;
      const updated = await actOnHqStocktake(token, stocktake.id, action);
      setStocktake({ ...stocktake, ...updated });
      setStatus(`盘点单状态：${updated.status}`);
    });
  }

  async function saveCount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stocktake) return;
    const data = new FormData(event.currentTarget);
    const countedQuantity = Number(data.get('countedQuantity'));
    const item = stocktake.items[0];
    if (!item || !Number.isInteger(countedQuantity) || countedQuantity < 0) return;
    await run(async () => {
      const updated = await countHqStocktake(token, stocktake.id, {
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

  async function createTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const destinationStoreId = text(data, 'destinationStoreId');
    const skuId = text(data, 'skuId');
    const quantity = Number(data.get('quantity'));
    if (!storeId || !destinationStoreId || !skuId || !Number.isInteger(quantity) || quantity <= 0)
      return;
    await run(async () => {
      const created = await createHqStockTransfer(token, {
        sourceStoreId: storeId,
        destinationStoreId,
        items: [{ skuId, quantity }],
      });
      setTransfer(created);
      form.reset();
      setStatus(`调拨单 ${created.transferNumber} 已创建`);
    });
  }

  function transferAction(action: 'SUBMIT' | 'DISPATCH' | 'RECEIVE' | 'CANCEL') {
    void run(async () => {
      if (!transfer) return;
      const updated = await actOnHqStockTransfer(token, transfer.id, action);
      setTransfer({ ...transfer, ...updated });
      setStatus(`调拨单状态：${updated.status}`);
    });
  }

  if (!storeId) {
    return (
      <section className="panel">
        <h3>总部库存操作</h3>
        <p>请先选择一个服务端授权门店。跨门店写操作不会在“全部范围”上下文中执行。</p>
      </section>
    );
  }

  const activeSuppliers = suppliers.filter((supplier) => supplier.status === 'ACTIVE');
  const destinationStores = stores.filter((store) => store.id !== storeId);

  return (
    <section className="panel">
      <h3>总部库存操作</h3>
      <p>
        所有写操作复用 M14 Staff API；页面只提供操作上下文，服务端继续执行权限与 Data Scope 校验。
      </p>
      {status && <p>{status}</p>}

      {canProcure && hasGlobalScope && (
        <div className="empty-state">
          <strong>供应商管理</strong>
          <form onSubmit={(event) => void createSupplier(event)}>
            <input name="code" required maxLength={120} placeholder="供应商编码" />
            <input name="name" required maxLength={120} placeholder="供应商名称" />
            <input name="contactName" maxLength={120} placeholder="联系人（可选）" />
            <input name="email" type="email" placeholder="邮箱（可选）" />
            <input name="phone" maxLength={40} placeholder="电话（可选）" />
            <button disabled={busy}>创建供应商</button>
          </form>
        </div>
      )}

      {canProcure && (
        <div className="empty-state">
          <strong>采购单</strong>
          <form onSubmit={(event) => void createPurchase(event)}>
            <select name="supplierId" required defaultValue="">
              <option value="" disabled>
                选择供应商
              </option>
              {activeSuppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
            <select name="skuId" required defaultValue="">
              <option value="" disabled>
                选择 SKU
              </option>
              {balances.map((item) => (
                <option key={item.skuId} value={item.skuId}>
                  {item.skuName} · {item.skuCode}
                </option>
              ))}
            </select>
            <input name="quantity" type="number" min="1" step="1" required placeholder="数量" />
            <input name="unitCostMinor" type="number" min="0" step="1" placeholder="单价（分）" />
            <input name="notes" maxLength={500} placeholder="备注（可选）" />
            <button disabled={busy || !activeSuppliers.length || !balances.length}>
              创建采购单
            </button>
          </form>
          {purchaseOrder && (
            <div>
              <strong>{purchaseOrder.orderNumber}</strong> · {purchaseOrder.status}
              {purchaseOrder.status === 'DRAFT' && (
                <>
                  <button disabled={busy} onClick={() => purchaseAction('SUBMIT')}>
                    提交
                  </button>
                  <button disabled={busy} onClick={() => purchaseAction('CANCEL')}>
                    取消
                  </button>
                </>
              )}
              {(purchaseOrder.status === 'SUBMITTED' ||
                purchaseOrder.status === 'PARTIALLY_RECEIVED') &&
                canReceive &&
                !receipt && (
                  <button disabled={busy} onClick={receiveOutstanding}>
                    创建剩余数量收货单
                  </button>
                )}
              {receipt?.status === 'DRAFT' && canReceive && (
                <button disabled={busy} onClick={postReceipt}>
                  过账 {receipt.receiptNumber}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {canStocktake && (
        <div className="empty-state">
          <strong>库存盘点</strong>
          <form onSubmit={(event) => void createCount(event)}>
            <select name="skuId" required defaultValue="">
              <option value="" disabled>
                选择 SKU
              </option>
              {balances.map((item) => (
                <option key={item.skuId} value={item.skuId}>
                  {item.skuName} · 账面 {item.onHand}
                </option>
              ))}
            </select>
            <button disabled={busy || !balances.length}>创建盘点单</button>
          </form>
          {stocktake && (
            <div>
              <strong>{stocktake.stocktakeNumber}</strong> · {stocktake.status}
              {stocktake.status === 'DRAFT' && (
                <>
                  <button disabled={busy} onClick={() => stocktakeAction('START')}>
                    开始
                  </button>
                  <button disabled={busy} onClick={() => stocktakeAction('CANCEL')}>
                    取消
                  </button>
                </>
              )}
              {stocktake.status === 'COUNTING' && (
                <form onSubmit={(event) => void saveCount(event)}>
                  <input name="countedQuantity" type="number" min="0" step="1" required />
                  <button disabled={busy}>保存实盘数</button>
                </form>
              )}
              {stocktake.status === 'COUNTING' &&
                stocktake.items.every((item) => item.countedQuantity !== null) && (
                  <button disabled={busy} onClick={() => stocktakeAction('REVIEW')}>
                    复核
                  </button>
                )}
              {stocktake.status === 'REVIEWED' && (
                <button disabled={busy} onClick={() => stocktakeAction('POST')}>
                  过账差异
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {canTransfer && (
        <div className="empty-state">
          <strong>门店调拨</strong>
          <form onSubmit={(event) => void createTransfer(event)}>
            <select name="destinationStoreId" required defaultValue="">
              <option value="" disabled>
                目标门店
              </option>
              {destinationStores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
            <select name="skuId" required defaultValue="">
              <option value="" disabled>
                选择 SKU
              </option>
              {balances.map((item) => (
                <option key={item.skuId} value={item.skuId}>
                  {item.skuName} · {item.skuCode}
                </option>
              ))}
            </select>
            <input name="quantity" type="number" min="1" step="1" required placeholder="数量" />
            <button disabled={busy || !destinationStores.length || !balances.length}>
              创建调拨单
            </button>
          </form>
          {transfer && (
            <div>
              <strong>{transfer.transferNumber}</strong> · {transfer.status}
              {transfer.status === 'DRAFT' && (
                <>
                  <button disabled={busy} onClick={() => transferAction('SUBMIT')}>
                    提交
                  </button>
                  <button disabled={busy} onClick={() => transferAction('CANCEL')}>
                    取消
                  </button>
                </>
              )}
              {transfer.status === 'SUBMITTED' && (
                <button disabled={busy} onClick={() => transferAction('DISPATCH')}>
                  发出
                </button>
              )}
              {transfer.status === 'IN_TRANSIT' && (
                <button disabled={busy} onClick={() => transferAction('RECEIVE')}>
                  收货
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function text(data: FormData, field: string) {
  const value = data.get(field);
  return typeof value === 'string' ? value.trim() : '';
}

function nullableText(data: FormData, field: string) {
  const value = text(data, field);
  return value || null;
}
