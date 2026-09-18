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
    setBusy(id);
    try {
      await rentalAction(token, id, action);
      setStatus('操作成功');
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? `操作失败：${e.message}` : '操作失败');
    } finally {
      setBusy('');
    }
  };
  return (
    <section className="panel">
      <span className="tag">M15 Rental Operations</span>
      <h2>门店租借</h2>
      <p>权限、门店范围、库存与状态均由服务端确认。</p>
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
            <span>
              {item.status === 'RESERVED' && (
                <button disabled={busy === item.id} onClick={() => void act(item.id, 'borrow')}>
                  确认借出
                </button>
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
