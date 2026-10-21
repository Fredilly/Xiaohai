import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { InventoryMutationRequest } from '@xiaohai/contracts/inventory';
import { adjustInventory, issueInventory, loadInventory } from './inventory-api';

type Balance = Awaited<ReturnType<typeof loadInventory>>['items'][number];

export function InventoryPanel({ token, storeId }: { token: string; storeId: string }) {
  const [items, setItems] = useState<Balance[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [status, setStatus] = useState('正在加载库存…');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const result = await loadInventory(token, storeId);
      setItems(result.items);
      setStatus(result.items.length ? '当前门店库存已从服务端加载' : '当前门店暂无库存');
    } catch (error) {
      setStatus(error instanceof Error ? `加载失败：${error.message}` : '加载失败');
    }
  }, [storeId, token]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setSelectedKey('');
  }, [storeId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const row = items.find((item) => `${item.storeId}:${item.skuId}` === selectedKey);
    if (!row) return;
    const form = new FormData(formElement);
    const quantity = Number(form.get('quantity'));
    const operation = form.get('operation');
    const reasonValue = form.get('reason');
    const reason = typeof reasonValue === 'string' ? reasonValue : '门店库存操作';
    const base: InventoryMutationRequest = {
      storeId: row.storeId,
      skuId: row.skuId,
      quantity: Math.abs(quantity),
      expectedVersion: row.version,
      idempotencyKey: crypto.randomUUID(),
      reason,
    };
    setBusy(true);
    try {
      if (operation === 'ISSUE') await issueInventory(token, base);
      else
        await adjustInventory(token, {
          storeId: base.storeId,
          skuId: base.skuId,
          expectedVersion: base.expectedVersion,
          idempotencyKey: base.idempotencyKey,
          reason: base.reason,
          quantityDelta: quantity,
        });
      setStatus('操作成功，库存与流水已同步更新');
      await refresh();
      formElement.reset();
      setSelectedKey('');
    } catch (error) {
      setStatus(error instanceof Error ? `操作失败：${error.message}` : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel inventory-panel">
      <span className="tag">M14 Inventory Operations</span>
      <h2>库存操作</h2>
      <p>当前门店由 M19 工作台选择器确定；余额、版本、写入权限与 Data Scope 仍由服务端确认。</p>
      <div className="data-table-scroll" role="region" aria-label="门店库存列表" tabIndex={0}>
        <table className="data-table data-table-compact">
          <thead>
            <tr>
              <th scope="col">商品 / SKU</th>
              <th scope="col" className="numeric">
                现存 / 可用
              </th>
              <th scope="col" className="numeric">
                库存版本
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.storeId}:${item.skuId}`}>
                <td>
                  <strong className="cell-title">{item.skuName}</strong>
                  <small className="cell-meta">{item.skuCode}</small>
                </td>
                <td className="numeric">
                  {item.onHand} / <strong>{item.available}</strong>
                </td>
                <td className="numeric">v{item.version}</td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={3} className="data-table-empty">
                  当前门店暂无库存记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {items.length > 0 && (
        <form className="operation-form" onSubmit={(event) => void submit(event)}>
          <label>
            库存项目
            <select
              value={selectedKey}
              onChange={(event) => setSelectedKey(event.target.value)}
              required
            >
              <option value="" disabled>
                请选择
              </option>
              {items.map((item) => (
                <option
                  key={`${item.storeId}:${item.skuId}`}
                  value={`${item.storeId}:${item.skuId}`}
                >
                  {item.skuName}（可用 {item.available}）
                </option>
              ))}
            </select>
          </label>
          <label>
            操作
            <select name="operation">
              <option value="ISSUE">出库</option>
              <option value="ADJUST">调整（可填负数）</option>
            </select>
          </label>
          <label>
            数量
            <input name="quantity" type="number" required min="-1000000" max="1000000" />
          </label>
          <label>
            原因
            <input name="reason" required maxLength={120} />
          </label>
          <button disabled={busy}>{busy ? '提交中…' : '提交库存操作'}</button>
        </form>
      )}
      <p role="status">{status}</p>
    </section>
  );
}
