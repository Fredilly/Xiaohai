import { useCallback, useEffect, useState } from 'react';
import type { RentalView } from '@xiaohai/contracts/rental';
import { loadRentals, rentalAction } from './rental-api';

const labels: Record<string, string> = {
  RESERVED: '已预约',
  BORROWED: '借阅中',
  OVERDUE: '已逾期',
  RETURNED: '已归还',
  CANCELLED: '已取消',
};

export function RentalPanel({ token }: { token: string }) {
  const [items, setItems] = useState<RentalView[]>([]);
  const [status, setStatus] = useState('正在加载…');
  const [busy, setBusy] = useState('');
  const [pickupCodes, setPickupCodes] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const result = await loadRentals(token);
      setItems(result.items);
      setStatus(result.items.length ? '租借记录已加载' : '授权范围内暂无租借记录');
    } catch (e) {
      setStatus(e instanceof Error ? `加载失败：${e.message}` : '加载失败');
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (id: string, action: 'borrow' | 'return') => {
    const pickupCode = pickupCodes[id]?.trim();
    if (action === 'borrow' && !/^\d{6}$/.test(pickupCode ?? '')) {
      setStatus('借出前请输入顾客出示的 6 位取书码');
      return;
    }
    setBusy(id);
    try {
      await rentalAction(token, id, action, pickupCode);
      setStatus('操作成功');
      setPickupCodes((current) => ({ ...current, [id]: '' }));
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? `操作失败：${e.message}` : '操作失败');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="panel">
      <span className="tag">M16 Pickup Verification + M15 Rental</span>
      <h2>门店租借</h2>
      <p>取书码只由顾客端显示。员工必须现场输入顾客出示的 6 位码，服务端再校验门店范围、库存与状态。</p>
      <div className="inventory-table">
        <div className="inventory-row heading">
          <span>租借 / 门店</span>
          <span>状态 / 到期</span>
          <span>操作</span>
        </div>
        {items.map((item) => (
          <div className="inventory-row" key={item.id}>
            <span>
              <strong>{item.rentalNumber}</strong>
              <small>{item.storeName}</small>
            </span>
            <span>
              {labels[item.status] ?? item.status}
              <small>{item.dueAt ? new Date(item.dueAt).toLocaleString() : '—'}</small>
            </span>
            <span className="inline-actions">
              {item.status === 'RESERVED' && (
                <>
                  <input
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6 位取书码"
                    value={pickupCodes[item.id] ?? ''}
                    onChange={(event) =>
                      setPickupCodes((current) => ({
                        ...current,
                        [item.id]: event.target.value.replace(/\D/g, '').slice(0, 6),
                      }))
                    }
                  />
                  <button disabled={busy === item.id} onClick={() => void act(item.id, 'borrow')}>
                    核验并借出
                  </button>
                </>
              )}
              {(item.status === 'BORROWED' || item.status === 'OVERDUE') && (
                <button disabled={busy === item.id} onClick={() => void act(item.id, 'return')}>
                  确认归还
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      <p role="status">{status}</p>
    </section>
  );
}
