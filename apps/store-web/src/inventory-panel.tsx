import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { InventoryMutationRequest } from '@xiaohai/contracts/inventory';
import {
  adjustInventory,
  findOpeningStockCandidates,
  issueInventory,
  loadInventory,
  registerOpeningStock,
} from './inventory-api';
import { StoreMeipingPreflightPanel } from './store-meiping-preflight-panel';

type Balance = Awaited<ReturnType<typeof loadInventory>>['items'][number];
type Candidate = Awaited<ReturnType<typeof findOpeningStockCandidates>>['items'][number];

export function InventoryPanel({
  token,
  storeId,
  permissions,
}: {
  token: string;
  storeId: string;
  permissions: string[];
}) {
  const [items, setItems] = useState<Balance[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [appliedInventoryQuery, setAppliedInventoryQuery] = useState('');
  const [status, setStatus] = useState('正在加载库存…');
  const [busy, setBusy] = useState(false);
  const [openingSearch, setOpeningSearch] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [openingSkuId, setOpeningSkuId] = useState('');
  const [openingStatus, setOpeningStatus] = useState('搜索总部商品或 SKU，开始本店首次库存建档。');
  const [openingBusy, setOpeningBusy] = useState(false);
  const openingKey = useRef(crypto.randomUUID());
  const canOpen =
    permissions.includes('inventory.read') && permissions.includes('inventory.adjust');
  const refresh = useCallback(async () => {
    try {
      const result = await loadInventory(token, storeId, appliedInventoryQuery);
      setItems(result.items);
      setStatus(result.items.length ? '当前门店库存已从服务端加载' : '当前门店暂无库存');
    } catch (error) {
      setStatus(error instanceof Error ? `加载失败：${error.message}` : '加载失败');
    }
  }, [storeId, token, appliedInventoryQuery]);
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

  async function searchOpening(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOpeningSkuId('');
    setCandidates([]);
    setOpeningStatus('正在搜索未关联本门店的商品…');
    setOpeningBusy(true);
    try {
      const result = await findOpeningStockCandidates(token, storeId, openingSearch.trim());
      setCandidates(result.items);
      setOpeningStatus(
        result.items.length ? '请选择要建档的 SKU' : '未找到未建档 SKU，请核对商品名称或编码',
      );
    } catch (error) {
      setOpeningStatus(error instanceof Error ? `搜索失败：${error.message}` : '搜索失败');
    } finally {
      setOpeningBusy(false);
    }
  }

  async function submitOpening(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const quantity = Number(data.get('initialQuantity'));
    const reason = data.get('reason');
    if (
      !openingSkuId ||
      !Number.isInteger(quantity) ||
      quantity < 0 ||
      quantity > 1_000_000 ||
      typeof reason !== 'string' ||
      !reason.trim()
    )
      return;
    setOpeningBusy(true);
    setOpeningStatus('正在建立库存记录并写入首次库存流水…');
    try {
      await registerOpeningStock(token, {
        storeId,
        skuId: openingSkuId,
        initialQuantity: quantity,
        reason: reason.trim(),
        idempotencyKey: openingKey.current,
      });
      openingKey.current = crypto.randomUUID();
      setCandidates((value) => value.filter((item) => item.skuId !== openingSkuId));
      setOpeningSkuId('');
      form.reset();
      setOpeningStatus('首次建档成功；有数量的商品已记入库存流水。草稿商品仍不可对外销售。');
      await refresh();
    } catch (error) {
      setOpeningStatus(error instanceof Error ? `建档失败：${error.message}` : '建档失败');
    } finally {
      setOpeningBusy(false);
    }
  }

  return (
    <section className="panel inventory-panel">
      <span className="tag">M14 Inventory Operations</span>
      <h2>库存操作</h2>
      <p>当前门店由 M19 工作台选择器确定；余额、版本、写入权限与 Data Scope 仍由服务端确认。</p>
      {permissions.includes('inventory.receive') && (
        <StoreMeipingPreflightPanel token={token} storeId={storeId} />
      )}
      {canOpen && (
        <section aria-label="首次库存建档">
          <h3>首次库存建档</h3>
          <p>
            总部先建立商品草稿；门店在这里搜索商品并登记首次实盘数量。只登记本店、尚未建档的
            SKU，已有库存请使用下方调整流程。
          </p>
          <p>首次数量大于 0 时会留下库存流水；数量为 0 时仅建立零库存关联，不会生成收货记录。</p>
          <form className="operation-form" onSubmit={(event) => void searchOpening(event)}>
            <label>
              商品名称 / SKU 编码
              <input
                aria-label="搜索待建档商品"
                value={openingSearch}
                onChange={(event) => setOpeningSearch(event.target.value)}
                maxLength={120}
                required
                placeholder="输入名称或 SKU 编码"
              />
            </label>
            <button disabled={openingBusy || !openingSearch.trim()}>搜索待建档 SKU</button>
          </form>
          {candidates.length > 0 && (
            <form className="operation-form" onSubmit={(event) => void submitOpening(event)}>
              <label>
                待建档 SKU
                <select
                  aria-label="选择待建档 SKU"
                  required
                  value={openingSkuId}
                  onChange={(event) => {
                    setOpeningSkuId(event.target.value);
                    openingKey.current = crypto.randomUUID();
                  }}
                >
                  <option value="" disabled>
                    请选择
                  </option>
                  {candidates.map((item) => (
                    <option key={item.skuId} value={item.skuId}>
                      {item.productName} / {item.skuName} · {item.skuCode}
                      {item.productStatus === 'DRAFT' ? '（草稿，不可售）' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                首次实盘数量（可为 0）
                <input
                  name="initialQuantity"
                  type="number"
                  min="0"
                  max="1000000"
                  step="1"
                  required
                  onChange={() => {
                    openingKey.current = crypto.randomUUID();
                  }}
                />
              </label>
              <label>
                建档依据 / 盘点备注
                <input
                  name="reason"
                  maxLength={120}
                  required
                  placeholder="如：门店首次实盘核对"
                  onChange={() => {
                    openingKey.current = crypto.randomUUID();
                  }}
                />
              </label>
              <label>
                <input name="verified" type="checkbox" required />
                已核对本店、商品及实盘数量
              </label>
              <button disabled={openingBusy || !openingSkuId}>
                {openingBusy ? '正在建档…' : '确认首次库存建档'}
              </button>
            </form>
          )}
          <p role="status">{openingStatus}</p>
        </section>
      )}
      <form
        className="operation-form"
        onSubmit={(event) => {
          event.preventDefault();
          setSelectedKey('');
          setAppliedInventoryQuery(inventoryQuery.trim());
        }}
      >
        <label>
          查询已有库存
          <input
            aria-label="查询已有库存 SKU"
            value={inventoryQuery}
            onChange={(event) => setInventoryQuery(event.target.value)}
            maxLength={120}
            placeholder="SKU 编码或名称；留空显示前 200 条"
          />
        </label>
        <button>查询库存</button>
      </form>
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
