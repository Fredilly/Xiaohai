import { useEffect, useState } from 'react';
import {
  paymentListResponseSchema,
  reconciliationResponseSchema,
  refundResponseSchema,
  type PaymentStatus,
} from '@xiaohai/contracts/payments';

const configuredBase: unknown = import.meta.env.VITE_API_BASE_URL;
const base = typeof configuredBase === 'string' ? configuredBase : 'http://127.0.0.1:3000';
export function PaymentsManager({ token }: { token: string }) {
  const [rows, setRows] = useState<PaymentStatus[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function call(path: string, body?: object): Promise<unknown> {
    const response = await fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error('支付操作失败：请检查权限、商户配置及对账记录。');
    return response.json() as Promise<unknown>;
  }
  async function load() {
    const data = paymentListResponseSchema.parse(await call('/api/v1/staff/payments'));
    setRows(data.payments);
  }
  useEffect(() => {
    void load().catch(() => setMessage('无法读取支付记录，需要 payments.read 与 GLOBAL scope。'));
  }, [token]);
  async function act(id: string, refund: boolean) {
    if (refund && !window.confirm('确认对该支付发起整单退款？金额由服务端确定。')) return;
    setBusy(true);
    try {
      const result = await call(
        refund ? '/api/v1/staff/refunds' : `/api/v1/staff/payments/${id}/reconcile`,
        refund ? { paymentId: id } : {},
      );
      setMessage(
        refund
          ? `退款状态：${refundResponseSchema.parse(result).status}`
          : `对账结果：${reconciliationResponseSchema.parse(result).outcome}`,
      );
      await load();
    } catch {
      setMessage('操作未确认完成，请查询对账；不要更换退款单号重复退款。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>支付与整单退款</h2>
      <p>
        最近 100 笔。服务端验证 payments.read / payments.refund / payments.reconcile 与 GLOBAL
        scope。
      </p>
      <p role="status">{message}</p>
      <button disabled={busy} onClick={() => void load().catch(() => setMessage('刷新失败'))}>
        刷新
      </button>
      {rows.map((row) => (
        <article key={row.id}>
          <p>
            订单 {row.orderId} · {row.status} · ¥{(row.amountMinor / 100).toFixed(2)}{' '}
            {row.reviewRequired ? '需人工处理' : ''}
          </p>
          <button disabled={busy} onClick={() => void act(row.id, false)}>
            查询微信并对账
          </button>
          <button
            disabled={busy || row.status !== 'SUCCEEDED'}
            onClick={() => void act(row.id, true)}
          >
            整单退款
          </button>
        </article>
      ))}
    </section>
  );
}
