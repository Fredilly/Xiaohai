import { useEffect, useRef, useState } from 'react';
import {
  paymentListResponseSchema,
  refundResponseSchema,
  reconciliationResponseSchema,
  type PaymentStatus,
} from '@xiaohai/contracts/payments';
type Props = { token: string; storeId: string; permissions: string[] };
const env = import.meta.env as { VITE_API_BASE_URL?: string };
export function StorePaymentsPanel(props: Props) {
  return <Session key={`${props.token}:${props.storeId}`} {...props} />;
}
function Session({ token, storeId, permissions }: Props) {
  const [rows, setRows] = useState<PaymentStatus[]>([]);
  const [message, setMessage] = useState('读取本店支付记录；退款不会自动登记实物退货。');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const read = useRef(0);
  const path = `/api/v1/staff/stores/${storeId}`;
  async function call(suffix: string, body?: unknown) {
    const response = await fetch(`${env.VITE_API_BASE_URL ?? ''}${path}${suffix}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return (await response.json()) as unknown;
  }
  async function load() {
    const version = ++read.current;
    try {
      const result = paymentListResponseSchema.parse(await call('/payments'));
      if (version === read.current) setRows(result.payments);
    } catch {
      if (version === read.current) {
        setRows([]);
        setMessage('无法确认本店支付记录，请核对权限与门店后刷新。');
      }
    }
  }
  useEffect(() => {
    void load();
    return () => {
      read.current++;
    };
  }, []);
  async function act(paymentId: string, refund: boolean) {
    if (pending.current || !rows.some((r) => r.id === paymentId)) return;
    if (!permissions.includes(refund ? 'payments.refund' : 'payments.reconcile')) return;
    if (
      !window.confirm(
        refund
          ? '确认对当前门店这笔支付发起整单退款？金额由服务端确定；实物接收必须另行登记。'
          : '确认查询这笔本店支付并对账？',
      )
    )
      return;
    pending.current = true;
    setBusy(true);
    try {
      const result = await call(
        refund ? '/refunds' : `/payments/${paymentId}/reconcile`,
        refund ? { paymentId } : {},
      );
      setMessage(
        refund
          ? `退款状态：${refundResponseSchema.parse(result).status}；未自动返还实物库存。`
          : `对账结果：${reconciliationResponseSchema.parse(result).outcome}`,
      );
      await load();
    } catch {
      setMessage('操作未确认完成；请查询原支付及退款对账，不要重复创建退款。');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-label="本店支付与退款">
      <h2>本店支付与整单退款</h2>
      <p>只显示本店履约订单的最近 100 笔支付。每项操作仍需独立权限；退款和实物退货分开处理。</p>
      <p role="status">{message}</p>
      <button disabled={busy} onClick={() => void load()}>
        刷新本店支付
      </button>
      <table>
        <thead>
          <tr>
            <th>订单</th>
            <th>金额</th>
            <th>支付状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.orderId}</td>
              <td>¥{(row.amountMinor / 100).toFixed(2)}</td>
              <td>
                {row.status}
                {row.reviewRequired ? ' · 需人工处理' : ''}
              </td>
              <td>
                {permissions.includes('payments.reconcile') && (
                  <button disabled={busy} onClick={() => void act(row.id, false)}>
                    查询对账
                  </button>
                )}
                {permissions.includes('payments.refund') && (
                  <button
                    disabled={busy || row.status !== 'SUCCEEDED'}
                    onClick={() => void act(row.id, true)}
                  >
                    整单退款（不返实物）
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
