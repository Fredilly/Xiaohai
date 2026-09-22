import { useEffect, useState } from 'react';
import {
  paymentListResponseSchema,
  reconciliationResponseSchema,
  refundResponseSchema,
  type PaymentStatus,
} from '@xiaohai/contracts/payments';
import { displayStatus, money } from './display';

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
    void load().catch(() => setMessage('无法读取支付记录，请检查权限或稍后重试。'));
  }, [token]);
  async function act(id: string, refund: boolean) {
    if (
      !window.confirm(
        refund
          ? '确认对该支付发起整单退款？金额由服务端确定。'
          : '确认查询微信支付状态并执行对账？',
      )
    )
      return;
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
      <p>显示最近 100 笔支付记录。退款和对账操作会保留审计记录。</p>
      <p role="status">{message}</p>
      <button disabled={busy} onClick={() => void load().catch(() => setMessage('刷新失败'))}>
        刷新
      </button>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>订单编号</th>
              <th>金额</th>
              <th>支付状态</th>
              <th>处理</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <code>{row.orderId}</code>
                </td>
                <td>{money(row.amountMinor)}</td>
                <td>
                  <span className="badge">{displayStatus(row.status)}</span>
                  {row.reviewRequired && ' · 需人工处理'}
                </td>
                <td className="row-actions">
                  <button disabled={busy} onClick={() => void act(row.id, false)}>
                    查询微信并对账
                  </button>
                  <button
                    disabled={busy || row.status !== 'SUCCEEDED'}
                    onClick={() => void act(row.id, true)}
                  >
                    整单退款
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p>暂无支付记录。</p>}
    </section>
  );
}
