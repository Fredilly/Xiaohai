import { FoodTraceabilityPanel } from './food-traceability-panel';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  type foodStockReadResponseSchema,
  foodLotIntakeRequestSchema,
  foodLotDispositionRequestSchema,
  foodBatchMovementRequestSchema,
} from '@xiaohai/contracts/food';
import { parseScopedFoodStock } from './food-response-scope';
import {
  assertFoodOperationResponse,
  clearFoodOperation,
  pendingFoodOperation,
  reserveFoodOperation,
  type FoodOperationPath,
  type PendingFoodOperation,
} from '@xiaohai/contracts/food-operation-retry';
type Snapshot = ReturnType<typeof foodStockReadResponseSchema.parse>;
type Props = {
  token: string;
  storeId: string;
  staffAccountId: string;
  permissions: string[];
  items: { skuId: string; skuName: string }[];
};
const env = import.meta.env as { VITE_API_BASE_URL?: string };
export function FoodStockPanel(props: Props) {
  return (
    <FoodStockSession key={`${props.staffAccountId}:${props.token}:${props.storeId}`} {...props} />
  );
}
function FoodStockSession({ token, storeId, staffAccountId, permissions, items }: Props) {
  const [skuId, setSkuId] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState('选择本店 SKU 后读取真实批次及服务端交易开关状态。');
  const [busy, setBusy] = useState(false);
  const requestVersion = useRef(0);
  const inFlight = useRef(false);
  const [pending, setPending] = useState<PendingFoodOperation | null>(null);
  async function request(suffix: string, body?: unknown) {
    const response = await fetch(
      `${env.VITE_API_BASE_URL ?? ''}/api/v1/staff/inventory/food-stock${suffix}`,
      {
        method: body ? 'POST' : 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return (await response.json()) as unknown;
  }
  async function load(): Promise<boolean> {
    const version = ++requestVersion.current;
    setSnapshot(null);
    if (!skuId) return false;
    try {
      const data = parseScopedFoodStock(
        await request(`?${new URLSearchParams({ storeId, skuId })}`),
        storeId,
        skuId,
      );
      if (version === requestVersion.current) {
        setSnapshot(data);
        return true;
      }
    } catch {
      if (version === requestVersion.current)
        setStatus('批次读取失败，请重新读取；不能据此进行库存操作。');
    }
    return false;
  }
  useEffect(() => {
    void load();
    return () => {
      requestVersion.current++;
    };
  }, [skuId]); // session is remounted on token/store changes
  useEffect(() => {
    try {
      const saved = pendingFoodOperation(staffAccountId, storeId);
      setPending(saved);
      if (saved) {
        setSkuId(saved.input.skuId);
        setStatus('上次食品批次写入结果未确认；请核对流水，或使用下方按钮重试原请求。');
      }
    } catch {
      setStatus('待确认食品批次记录无法读取，已阻止新的写入；请联系管理员核对流水。');
    }
  }, [staffAccountId, storeId]);

  async function postOperation(operation: PendingFoodOperation, formElement?: HTMLFormElement) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    let confirmed = false;
    try {
      assertFoodOperationResponse(operation, await request(operation.path, operation.input));
      confirmed = true;
      clearFoodOperation(staffAccountId, storeId, operation.input.idempotencyKey);
      setPending(null);
      formElement?.reset();
      setStatus('写入已成功响应，正在重新读取批次。');
      const refreshed = await load();
      setStatus(
        refreshed
          ? '操作已提交，库存与批次已刷新。'
          : '写入已成功响应，但批次刷新未确认；请先重新读取库存，勿重复提交原操作。',
      );
    } catch {
      setStatus(
        confirmed
          ? '写入已成功响应，但无法清除本地待确认记录；请核对库存流水，勿新建相同操作。'
          : '写入未确认成功；原请求已保存在本标签页。请核对流水或按原请求重试，勿修改后另建一笔。',
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function retryPending() {
    if (inFlight.current) return;
    try {
      const saved = pendingFoodOperation(staffAccountId, storeId);
      if (!saved) {
        setPending(null);
        return;
      }
      if (!items.some((item) => item.skuId === saved.input.skuId)) {
        setStatus('原 SKU 不在当前门店授权库存列表中；请先核对门店与库存流水。');
        return;
      }
      await postOperation(saved);
    } catch {
      setStatus('无法安全恢复原食品批次请求；已停止提交，请核对库存流水。');
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (inFlight.current || !snapshot || snapshot.storeId !== storeId || snapshot.skuId !== skuId)
      return;
    const data = new FormData(formElement);
    const operation = text(data, 'operation');
    const reason = text(data, 'reason');
    const sourceRef = text(data, 'sourceRef');
    const common = { storeId, skuId, expectedInventoryVersion: snapshot.inventoryVersion, reason };
    let suffix = '';
    let raw: Record<string, unknown>;
    if (operation === 'intake') {
      suffix = '/intake';
      raw = {
        ...common,
        sourceRef,
        kind: text(data, 'kind'),
        lotCode: text(data, 'lotCode'),
        manufacturedOn: text(data, 'manufacturedOn') || null,
        expiresOn: text(data, 'expiresOn'),
        quantity: Number(data.get('quantity')),
      };
    } else if (operation === 'state') {
      const batch = snapshot.rows.find((r) => r.id === data.get('batchId'));
      if (!batch) return;
      suffix = '/disposition';
      raw = {
        ...common,
        sourceRef,
        batchId: batch.id,
        expectedVersion: batch.version,
        state: text(data, 'state'),
      };
    } else {
      suffix = '/movements';
      raw = {
        ...common,
        kind: operation,
        lines: snapshot.rows
          .map((r) => ({
            batchId: r.id,
            expectedVersion: r.version,
            quantity: Number(data.get(`qty:${r.id}`)),
          }))
          .filter((r) => r.quantity > 0),
      };
    }
    const schema =
      operation === 'intake'
        ? foodLotIntakeRequestSchema
        : operation === 'state'
          ? foodLotDispositionRequestSchema
          : foodBatchMovementRequestSchema;
    const parsed = schema.safeParse({ ...raw, idempotencyKey: crypto.randomUUID() });
    if (!parsed.success) {
      setStatus('请检查必填项、数量、日期及不含 URL 的凭证编号。');
      return;
    }
    try {
      const saved = reserveFoodOperation(
        staffAccountId,
        storeId,
        suffix as FoodOperationPath,
        parsed.data,
      );
      setPending(saved);
      await postOperation(saved, formElement);
    } catch {
      setStatus('上次操作未确认或会话存储不可用，已阻止新写入；先恢复原请求或核对流水。');
    }
  }
  const evidence = (
    <>
      <label>
        原因
        <input name="reason" required maxLength={500} />
      </label>
      <label>
        内部凭证编号（不填网址）
        <input name="sourceRef" required pattern="[A-Za-z0-9._:-]{8,128}" />
      </label>
    </>
  );
  return (
    <section aria-label="食品批次管理">
      <h3>预包装食品与瓶装饮料批次</h3>
      <FoodTraceabilityPanel
        token={token}
        storeId={storeId}
        staffAccountId={staffAccountId}
        permissions={permissions}
      />
      <p>新批次默认冻结；不支持现制配方扣料。食品下单状态以服务端配置和实时批次校验为准。</p>
      <label>
        本店 SKU
        <select
          value={skuId}
          disabled={busy}
          onChange={(e) => {
            setSnapshot(null);
            setSkuId(e.target.value);
          }}
        >
          <option value="">请选择</option>
          {items.map((r) => (
            <option key={r.skuId} value={r.skuId}>
              {r.skuName}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={!skuId || busy} onClick={() => void load()}>
        重新读取批次
      </button>
      <p role="status">{status}</p>
      {pending && (
        <aside role="alert">
          <p>
            待确认操作：{pending.path}；SKU {pending.input.skuId}。不可更改数量或批次后生成新请求。
          </p>
          <button
            type="button"
            disabled={
              busy ||
              !items.some((item) => item.skuId === pending.input.skuId) ||
              !permissions.includes(
                pending.path === '/intake' ? 'inventory.receive' : 'inventory.adjust',
              )
            }
            onClick={() => void retryPending()}
          >
            使用原请求键重试
          </button>
        </aside>
      )}
      {snapshot && (
        <>
          <p>
            总库存 {snapshot.onHand}；批次校验 {snapshot.result.status}；批次可售量{' '}
            {snapshot.result.sellable}（
            {snapshot.checkoutEnabled ? '交易流程已启用，仍需结算复核' : '食品交易未启用'}）
          </p>
          <table>
            <thead>
              <tr>
                <th>批号</th>
                <th>到期日</th>
                <th>状态</th>
                <th>数量</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.lotCode}
                    <br />
                    <small>批次 ID：{r.id}</small>
                  </td>
                  <td>{r.expiresOn}</td>
                  <td>{r.state}</td>
                  <td>{r.onHand}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {permissions.includes('inventory.receive') && (
            <form onSubmit={(e) => void submit(e)}>
              <fieldset disabled={busy}>
                <legend>新批次入库（新食品须先建草稿、关联零库存）</legend>
                <input type="hidden" name="operation" value="intake" />
                <label>
                  种类
                  <select name="kind">
                    <option value="PACKAGED_FOOD">预包装食品</option>
                    <option value="SEALED_BEVERAGE">瓶装饮料</option>
                  </select>
                </label>
                <label>
                  批号
                  <input name="lotCode" required maxLength={100} />
                </label>
                <label>
                  生产日期
                  <input name="manufacturedOn" type="date" />
                </label>
                <label>
                  到期日
                  <input name="expiresOn" type="date" required />
                </label>
                <label>
                  入库数量
                  <input name="quantity" type="number" min={1} max={1000000} required />
                </label>
                {evidence}
                <button>入库并冻结</button>
              </fieldset>
            </form>
          )}
          {permissions.includes('inventory.adjust') && snapshot.rows.length > 0 && (
            <>
              <form onSubmit={(e) => void submit(e)}>
                <fieldset disabled={busy}>
                  <legend>冻结、召回与检查后释放</legend>
                  <input type="hidden" name="operation" value="state" />
                  <select name="batchId" aria-label="待处理批次">
                    {snapshot.rows.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.lotCode}
                      </option>
                    ))}
                  </select>
                  <select name="state" aria-label="目标状态">
                    <option value="HELD">冻结</option>
                    <option value="RECALLED">召回</option>
                    <option value="AVAILABLE">检查后释放</option>
                  </select>
                  {evidence}
                  <button>提交状态变更</button>
                </fieldset>
              </form>
              <form onSubmit={(e) => void submit(e)}>
                <fieldset disabled={busy}>
                  <legend>多批次报损、盘亏或冻结/过期销毁</legend>
                  <select name="operation" aria-label="库存变动类型">
                    <option value="DAMAGE">可用批次报损</option>
                    <option value="DISPOSAL">冻结/召回/过期批次销毁</option>
                    <option value="STOCKTAKE_LOSS">盘亏</option>
                  </select>
                  {snapshot.rows.map((r) => (
                    <label key={r.id}>
                      {r.lotCode} 数量
                      <input
                        name={`qty:${r.id}`}
                        type="number"
                        min={0}
                        max={1000000}
                        defaultValue={0}
                      />
                    </label>
                  ))}
                  <label>
                    原因
                    <input name="reason" required maxLength={500} />
                  </label>
                  <button>提交批次变动</button>
                </fieldset>
              </form>
            </>
          )}
        </>
      )}
    </section>
  );
}

function text(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}
