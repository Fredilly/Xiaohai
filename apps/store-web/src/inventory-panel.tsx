import { FoodStockPanel } from './food-stock-panel';
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
import {
  assertOpeningStockResponse,
  clearOpeningStock,
  pendingOpeningStock,
  reserveOpeningStock,
  type PendingOpeningStock,
} from './opening-stock-retry';
import {
  assertInventoryMutationResponse,
  clearInventoryMutation,
  pendingInventoryMutation,
  reserveInventoryMutation,
  type PendingInventoryMutation,
} from './inventory-mutation-retry';

type Balance = Awaited<ReturnType<typeof loadInventory>>['items'][number];
type Candidate = Awaited<ReturnType<typeof findOpeningStockCandidates>>['items'][number];

type InventoryPanelProps = {
  token: string;
  storeId: string;
  staffAccountId: string;
  permissions: string[];
};

export function InventoryPanel(props: InventoryPanelProps) {
  return (
    <InventorySession key={`${props.staffAccountId}:${props.token}:${props.storeId}`} {...props} />
  );
}

function InventorySession({ token, storeId, staffAccountId, permissions }: InventoryPanelProps) {
  const [items, setItems] = useState<Balance[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [appliedInventoryQuery, setAppliedInventoryQuery] = useState('');
  const [status, setStatus] = useState('正在加载库存…');
  const [busy, setBusy] = useState(false);
  const [pendingMutation, setPendingMutation] = useState<PendingInventoryMutation | null>(null);
  const mutationInFlight = useRef(false);
  const inventoryRead = useRef(0);
  const currentQuery = useRef(appliedInventoryQuery);
  currentQuery.current = appliedInventoryQuery;
  const [openingSearch, setOpeningSearch] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [openingSkuId, setOpeningSkuId] = useState('');
  const [openingStatus, setOpeningStatus] = useState('搜索商品或 SKU，开始本店首次库存建档。');
  const [openingBusy, setOpeningBusy] = useState(false);
  const [pendingOpening, setPendingOpening] = useState<PendingOpeningStock | null>(null);
  const openingInFlight = useRef(false);
  const canOpen =
    permissions.includes('inventory.read') && permissions.includes('inventory.adjust');
  const canIssue = permissions.includes('inventory.issue');
  const canAdjust = permissions.includes('inventory.adjust');
  const refresh = useCallback(async () => {
    if (currentQuery.current !== appliedInventoryQuery) return;
    const read = ++inventoryRead.current;
    try {
      const result = await loadInventory(token, storeId, appliedInventoryQuery);
      if (read !== inventoryRead.current || currentQuery.current !== appliedInventoryQuery) return;
      setItems(result.items);
      setStatus(result.items.length ? '当前门店库存已从服务端加载' : '当前门店暂无库存');
    } catch (error) {
      if (read !== inventoryRead.current || currentQuery.current !== appliedInventoryQuery) return;
      setStatus(error instanceof Error ? `加载失败：${error.message}` : '加载失败');
    }
  }, [storeId, token, appliedInventoryQuery]);
  useEffect(() => {
    void refresh();
    return () => {
      inventoryRead.current++;
    };
  }, [refresh]);

  useEffect(() => {
    setSelectedKey('');
  }, [storeId]);

  useEffect(() => {
    try {
      const previous = pendingInventoryMutation(staffAccountId, storeId);
      setPendingMutation(previous);
      if (previous) setStatus('上次出库／调整结果未确认；请先按原键恢复或核对库存流水。');
    } catch {
      setStatus('待确认库存操作记录损坏或存储不可用，已停止新库存写入；请人工核对流水。');
    }
  }, [staffAccountId, storeId]);

  useEffect(() => {
    try {
      const previous = pendingOpeningStock(staffAccountId, storeId);
      setPendingOpening(previous);
      if (previous)
        setOpeningStatus(
          previous.input.initialQuantity === 0
            ? '上次 0 件首次建档未确认；不能重发 POST，请先只读核对本店 SKU 关联。'
            : '上次首次库存建档结果未确认；可核对流水或使用原请求键重试。',
        );
    } catch {
      setOpeningStatus('待确认建档记录无法安全读取，已停止新的建档写入；请核对真实库存。');
    }
  }, [staffAccountId, storeId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationInFlight.current) return;
    const formElement = event.currentTarget;
    const row = items.find((item) => `${item.storeId}:${item.skuId}` === selectedKey);
    if (!row || row.storeId !== storeId) return;
    const form = new FormData(formElement);
    const quantity = Number(form.get('quantity'));
    const operation = form.get('operation');
    if ((operation === 'ISSUE' && !canIssue) || (operation === 'ADJUST' && !canAdjust)) return;
    if (operation !== 'ISSUE' && operation !== 'ADJUST') return;
    const reasonValue = form.get('reason');
    const reason = typeof reasonValue === 'string' ? reasonValue.trim() : '';
    if (
      !Number.isSafeInteger(quantity) ||
      quantity === 0 ||
      Math.abs(quantity) > 1_000_000 ||
      (operation === 'ISSUE' && quantity < 0) ||
      !reason
    )
      return;
    const base: InventoryMutationRequest = {
      storeId: row.storeId,
      skuId: row.skuId,
      quantity: Math.abs(quantity),
      expectedVersion: row.version,
      idempotencyKey: crypto.randomUUID(),
      reason,
    };
    try {
      const saved = reserveInventoryMutation(
        staffAccountId,
        storeId,
        operation,
        operation === 'ISSUE'
          ? base
          : {
              storeId: base.storeId,
              skuId: base.skuId,
              expectedVersion: base.expectedVersion,
              idempotencyKey: base.idempotencyKey,
              reason: base.reason,
              quantityDelta: quantity,
            },
      );
      setPendingMutation(saved);
      await postMutation(saved, formElement);
    } catch {
      setStatus('上次库存操作未确认或请求键无法保存；已阻止新操作，请先恢复原键或核对流水。');
    }
  }

  async function postMutation(saved: PendingInventoryMutation, form?: HTMLFormElement) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusy(true);
    setStatus('按保存的原请求键执行库存操作…');
    let confirmed = false;
    try {
      const result =
        saved.operation === 'ISSUE'
          ? await issueInventory(token, saved.input)
          : await adjustInventory(token, saved.input);
      assertInventoryMutationResponse(saved, staffAccountId, result);
      confirmed = true;
      clearInventoryMutation(staffAccountId, storeId, saved.input.idempotencyKey);
      setPendingMutation(null);
      setStatus('操作成功，服务端已确认原请求的库存流水');
      await refresh();
      form?.reset();
      setSelectedKey('');
    } catch {
      setStatus(
        confirmed
          ? '库存流水已确认，但本地待确认记录无法清除，请核对后处理。'
          : '出库／调整结果未确认，原请求已保留；禁止更换参数生成新操作。',
      );
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  }

  async function retryPendingMutation() {
    if (mutationInFlight.current) return;
    try {
      const saved = pendingInventoryMutation(staffAccountId, storeId);
      if (!saved) {
        setPendingMutation(null);
        return;
      }
      if (
        (saved.operation === 'ISSUE' && !canIssue) ||
        (saved.operation === 'ADJUST' && !canAdjust)
      )
        throw new Error('INVENTORY_PERMISSION_CHANGED');
      await postMutation(saved);
    } catch {
      setStatus('无法安全恢复原操作或当前权限不足；请核对库存流水。');
    }
  }

  async function searchOpening(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (openingInFlight.current) return;
    openingInFlight.current = true;
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
      openingInFlight.current = false;
      setOpeningBusy(false);
    }
  }

  async function submitOpening(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (openingInFlight.current) return;
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
    try {
      const pending = pendingOpeningStock(staffAccountId, storeId);
      if (pending?.input.initialQuantity === 0) {
        setOpeningStatus('0 件首次建档结果未确认，禁止重发；请只读核对本店 SKU 关联。');
        return;
      }
      const candidate = candidates.find((item) => item.skuId === openingSkuId);
      if (!candidate) return;
      const saved = reserveOpeningStock(staffAccountId, storeId, candidate.skuCode, {
        storeId,
        skuId: openingSkuId,
        initialQuantity: quantity,
        reason: reason.trim(),
        idempotencyKey: crypto.randomUUID(),
      });
      setPendingOpening(saved);
      await postOpening(saved, form);
    } catch {
      setOpeningStatus(
        '上次建档结果未确认或本地会话存储不可用，已阻止新建档；请先恢复原请求或核对流水。',
      );
    }
  }

  async function postOpening(saved: PendingOpeningStock, form?: HTMLFormElement) {
    if (openingInFlight.current) return;
    openingInFlight.current = true;
    setOpeningBusy(true);
    setOpeningStatus('正在按已保存的原请求建立本店首次库存记录…');
    let confirmed = false;
    try {
      assertOpeningStockResponse(saved.input, await registerOpeningStock(token, saved.input));
      confirmed = true;
      clearOpeningStock(staffAccountId, storeId, saved.input.idempotencyKey);
      setPendingOpening(null);
      setCandidates((current) => current.filter((item) => item.skuId !== saved.input.skuId));
      setOpeningSkuId('');
      form?.reset();
      setOpeningStatus('首次库存建档已由服务端确认；正数库存有独立流水，草稿仍不可售。');
      await refresh();
    } catch {
      setOpeningStatus(
        confirmed
          ? '建档写入已成功确认，但本地待确认记录未能清理；请核对库存流水。'
          : saved.input.initialQuantity === 0
            ? '0 件建档结果未确认；只能只读核对关联是否存在，禁止直接重发 POST。'
            : '首次建档结果未确认，原请求已保留；请核对库存流水或原键重试。',
      );
    } finally {
      openingInFlight.current = false;
      setOpeningBusy(false);
    }
  }

  async function retryPendingOpening() {
    if (openingInFlight.current) return;
    try {
      const saved = pendingOpeningStock(staffAccountId, storeId);
      if (!saved) {
        setPendingOpening(null);
        return;
      }
      if (saved.input.initialQuantity === 0) {
        setOpeningStatus('0 件建档没有可重放的唯一流水；只允许核对已建档状态。');
        return;
      }
      await postOpening(saved);
    } catch {
      setOpeningStatus('无法安全恢复原建档请求，已停止写入；请核对库存流水。');
    }
  }

  async function reconcileZeroOpening() {
    if (openingInFlight.current) return;
    openingInFlight.current = true;
    setOpeningBusy(true);
    try {
      const saved = pendingOpeningStock(staffAccountId, storeId);
      if (!saved || saved.input.initialQuantity !== 0) return;
      const read = await loadInventory(token, storeId, saved.skuCode);
      if (read.items.some((item) => item.storeId !== storeId))
        throw new Error('INVENTORY_STORE_MISMATCH');
      const found = read.items.find(
        (item) => item.storeId === storeId && item.skuId === saved.input.skuId,
      );
      if (!found) {
        setOpeningStatus('当前只读库存中未找到原 SKU；无法确定原 0 件写入是否成功，已保持阻塞。');
        return;
      }
      clearOpeningStock(staffAccountId, storeId, saved.input.idempotencyKey);
      setPendingOpening(null);
      setOpeningStatus(
        `已只读确认本店 SKU 关联存在（当前数量 ${found.onHand}）；不代表原请求必然成功，请按库存流水核对。`,
      );
      await refresh();
    } catch {
      setOpeningStatus('只读核对失败或返回对象不匹配；未再次 POST，待确认记录保留。');
    } finally {
      openingInFlight.current = false;
      setOpeningBusy(false);
    }
  }

  return (
    <section className="panel inventory-panel">
      <span className="tag">M14 Inventory Operations</span>
      <h2>库存操作</h2>
      <FoodStockPanel
        token={token}
        storeId={storeId}
        staffAccountId={staffAccountId}
        permissions={permissions}
        items={items}
      />
      <p>当前门店由 M19 工作台选择器确定；余额、版本、写入权限与 Data Scope 仍由服务端确认。</p>
      {permissions.includes('inventory.receive') && (
        <StoreMeipingPreflightPanel token={token} storeId={storeId} />
      )}
      {canOpen && (
        <section aria-label="首次库存建档">
          <h3>首次库存建档</h3>
          <p>
            商品草稿可由总部或获授权的门店创建。门店在这里搜索商品并登记首次实盘数量。只登记本店、尚未建档的
            SKU，已有库存请使用下方调整流程。
          </p>
          <p>首次数量大于 0 时会留下库存流水；数量为 0 时仅建立零库存关联，不会生成收货记录。</p>
          {pendingOpening && (
            <aside role="alert">
              <p>
                待确认首次建档：SKU {pendingOpening.skuCode}，数量{' '}
                {pendingOpening.input.initialQuantity}。 不允许更换原 SKU 或数量后建立第二笔操作。
              </p>
              {pendingOpening.input.initialQuantity > 0 ? (
                <button
                  type="button"
                  disabled={openingBusy}
                  onClick={() => void retryPendingOpening()}
                >
                  使用原首次建档请求重试
                </button>
              ) : (
                <button
                  type="button"
                  disabled={openingBusy}
                  onClick={() => void reconcileZeroOpening()}
                >
                  只读核对 0 件建档状态
                </button>
              )}
            </aside>
          )}
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
              <fieldset className="inventory-mutation-fields" disabled={openingBusy}>
                <label>
                  待建档 SKU
                  <select
                    aria-label="选择待建档 SKU"
                    required
                    value={openingSkuId}
                    onChange={(event) => {
                      setOpeningSkuId(event.target.value);
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
                  />
                </label>
                <label>
                  建档依据 / 盘点备注
                  <input
                    name="reason"
                    maxLength={120}
                    required
                    placeholder="如：门店首次实盘核对"
                  />
                </label>
                <label>
                  <input name="verified" type="checkbox" required />
                  已核对本店、商品及实盘数量
                </label>
                <button disabled={openingBusy || !openingSkuId}>
                  {openingBusy ? '正在建档…' : '确认首次库存建档'}
                </button>
              </fieldset>
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
      {items.length > 0 && (canIssue || canAdjust) && (
        <form className="operation-form" onSubmit={(event) => void submit(event)}>
          <fieldset className="inventory-mutation-fields" disabled={busy}>
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
                {canIssue && <option value="ISSUE">出库</option>}
                {canAdjust && <option value="ADJUST">调整（可填负数）</option>}
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
          </fieldset>
        </form>
      )}
      {pendingMutation && (canIssue || canAdjust) && (
        <aside role="alert">
          <p>
            待确认库存操作：{pendingMutation.operation === 'ISSUE' ? '出库' : '调整'}，SKU{' '}
            {pendingMutation.input.skuId}，数量{' '}
            {pendingMutation.operation === 'ISSUE'
              ? pendingMutation.input.quantity
              : pendingMutation.input.quantityDelta}
            。 仅允许原请求键重试，不能另建操作。
          </p>
          <button type="button" disabled={busy} onClick={() => void retryPendingMutation()}>
            按原库存请求键重试
          </button>
        </aside>
      )}
      <p role="status">{status}</p>
    </section>
  );
}
