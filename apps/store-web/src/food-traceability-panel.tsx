import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  type foodOrderAllocationsResponseSchema,
  foodPhysicalReturnRequestSchema,
} from '@xiaohai/contracts/food';
import { parseScopedFoodOrder, parseScopedFoodTrace } from './food-response-scope';
import {
  assertFoodReturnResponse,
  clearFoodReturn,
  pendingFoodReturn,
  reserveFoodReturn,
  type PendingFoodReturn,
} from '@xiaohai/contracts/food-return-retry';
type Props = { token: string; storeId: string; staffAccountId: string; permissions: string[] };
const env = import.meta.env as { VITE_API_BASE_URL?: string };
export function FoodTraceabilityPanel(props: Props) {
  return <Session key={`${props.staffAccountId}:${props.token}:${props.storeId}`} {...props} />;
}
function Session({ token, storeId, staffAccountId, permissions }: Props) {
  const [order, setOrder] = useState<ReturnType<
    typeof foodOrderAllocationsResponseSchema.parse
  > | null>(null);
  const [status, setStatus] = useState('退款仅处理金额；实物退回需单独接收，默认冻结。');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [pending, setPending] = useState<PendingFoodReturn | null>(null);
  useEffect(() => {
    try {
      const previous = pendingFoodReturn(staffAccountId, storeId);
      setPending(previous);
      if (previous) setStatus('存在未确认的食品实物接收，请核对退货流水或重放下方原请求。');
    } catch {
      setStatus('待确认实物接收记录无效；已阻止新的实物写入，请核对库存流水。');
    }
  }, [staffAccountId, storeId]);
  async function request(path: string, body?: unknown) {
    const r = await fetch(
      `${env.VITE_API_BASE_URL ?? ''}/api/v1/staff/inventory/food-stock${path}`,
      {
        method: body ? 'POST' : 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    if (!r.ok) throw new Error(`HTTP_${r.status}`);
    return (await r.json()) as unknown;
  }
  async function run(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await work();
    } catch {
      setStatus('操作未确认成功，请核对权限、门店、批次和请求状态；不要重复登记实物。');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function loadOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const id = text(new FormData(event.currentTarget), 'orderId');
    setOrder(null);
    await run(async () => {
      const next = parseScopedFoodOrder(
        await request(`/order/${encodeURIComponent(id)}`),
        storeId,
        id,
      );
      setOrder(next);
      setStatus('原订单批次已读取。只接收实际收到的实物，不能用退款记录代替。');
    });
  }
  async function receive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!order || order.storeId !== storeId) return;
    const data = new FormData(event.currentTarget);
    const reservationId = text(data, 'reservationId');
    const raw = {
      reservationId,
      quantity: Number(data.get('quantity')),
      reason: text(data, 'reason'),
      sourceRef: text(data, 'sourceRef'),
    };
    const selected = order.allocations.find((r) => r.id === reservationId);
    if (
      !selected ||
      selected.status !== 'SOLD' ||
      raw.quantity > selected.quantity - selected.returnedQuantity
    ) {
      setStatus('实际接收数量不能超过原售出批次未退回数量。');
      return;
    }
    const parsed = foodPhysicalReturnRequestSchema.safeParse({
      ...raw,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success) {
      setStatus('请核对数量、原因和内部凭证编号。');
      return;
    }
    try {
      const saved = reserveFoodReturn(staffAccountId, storeId, order.orderId, parsed.data);
      setPending(saved);
      await submitReturn(saved);
    } catch {
      setStatus('上次实物退货结果未确认或会话存储不可用；请先恢复原请求、核对流水。');
    }
  }
  async function submitReturn(saved: PendingFoodReturn) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    let confirmed = false;
    try {
      assertFoodReturnResponse(await request('/physical-returns', saved.input));
      confirmed = true;
      clearFoodReturn(staffAccountId, storeId, saved.input.idempotencyKey);
      setPending(null);
      setOrder(null);
      setStatus('实物接收已成功响应，正在核对原订单批次。');
      try {
        const next = parseScopedFoodOrder(
          await request(`/order/${encodeURIComponent(saved.orderId)}`),
          storeId,
          saved.orderId,
        );
        setOrder(next);
        setStatus('实物已按原批次接收为新的冻结批次；没有自动退款或恢复可售。');
      } catch {
        setStatus('实物接收写入已成功响应，但订单批次读回失败；请重新读取，勿重复登记。');
      }
    } catch {
      setStatus(
        confirmed
          ? '实物接收已成功响应，但本地待确认记录清理失败；请核对流水。'
          : '实物接收结果未确认；原请求已保存，可在同标签页刷新后使用原键重试。',
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function retryPending() {
    if (inFlight.current) return;
    try {
      const saved = pendingFoodReturn(staffAccountId, storeId);
      if (!saved) {
        setPending(null);
        return;
      }
      await submitReturn(saved);
    } catch {
      setStatus('原实物退货请求无法安全恢复，已停止提交；请核对流水。');
    }
  }
  async function trace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const id = text(new FormData(event.currentTarget), 'batchId');
    await run(async () => {
      const result = parseScopedFoodTrace(
        await request(`/trace/${encodeURIComponent(id)}`),
        storeId,
        id,
      );
      setStatus(
        `批号 ${result.lotCode}；调拨来源 ${result.transfers.map((r) => r.sourceBatchId).join('、') || '无'}；退货来源 ${result.returns.map((r) => r.reservationId).join('、') || '无'}。这里只显示来源标识，不公开其他门店库存。`,
      );
    });
  }
  return (
    <section aria-label="食品退货与溯源">
      <h3>食品实物退货与批次溯源</h3>
      <p role="status">{status}</p>
      {pending && (
        <aside role="alert">
          <p>
            待确认原订单 {pending.orderId}、原售出批次 {pending.input.reservationId}
            。不要重复登记实物。
          </p>
          <button
            type="button"
            disabled={busy || !permissions.includes('inventory.receive')}
            onClick={() => void retryPending()}
          >
            使用原实物接收请求重试
          </button>
        </aside>
      )}
      <form onSubmit={(e) => void loadOrder(e)}>
        <label>
          原订单 ID
          <input name="orderId" required disabled={busy} />
        </label>
        <button disabled={busy}>读取原订单批次</button>
      </form>
      {order && (
        <>
          <p>
            原订单 {order.orderId}；门店 {order.storeId}；状态 {order.status}
          </p>
          <table>
            <thead>
              <tr>
                <th>原批号</th>
                <th>售出数量</th>
                <th>已收实物</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {order.allocations.map((r) => (
                <tr key={r.id}>
                  <td>{r.lotCode}</td>
                  <td>{r.quantity}</td>
                  <td>{r.returnedQuantity}</td>
                  <td>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {permissions.includes('inventory.receive') && (
            <form onSubmit={(e) => void receive(e)}>
              <fieldset disabled={busy}>
                <legend>确认收到实物（与退款分开）</legend>
                <select name="reservationId" aria-label="原售出批次">
                  {order.allocations
                    .filter((r) => r.status === 'SOLD' && r.returnedQuantity < r.quantity)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.lotCode}，最多 {r.quantity - r.returnedQuantity}
                      </option>
                    ))}
                </select>
                <label>
                  实际收到数量
                  <input name="quantity" type="number" min={1} max={1000000} required />
                </label>
                <label>
                  原因
                  <input name="reason" required maxLength={500} />
                </label>
                <label>
                  内部接收凭证
                  <input name="sourceRef" pattern="[A-Za-z0-9._:-]{8,128}" required />
                </label>
                <button>接收为冻结批次</button>
              </fieldset>
            </form>
          )}
        </>
      )}
      <form onSubmit={(e) => void trace(e)}>
        <label>
          本店批次 ID
          <input name="batchId" required disabled={busy} />
        </label>
        <button disabled={busy}>查询批次来源</button>
      </form>
      <p>食品调拨使用现有调拨单：提交、发出、实际到店后接收；到店批次须检查后单独释放。</p>
    </section>
  );
}
function text(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}
