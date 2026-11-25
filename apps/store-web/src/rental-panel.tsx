import { useCallback, useEffect, useRef, useState } from 'react';
import type { RentalView } from '@xiaohai/contracts/rental';
import { loadRentals, rentalAction } from './rental-api';
import {
  clearRentalActionKey,
  getOrCreateRentalActionKey,
  pendingRentalActionKey,
} from './rental-retry';

const labels: Record<string, string> = {
  RESERVED: '已预约',
  BORROWED: '借阅中',
  OVERDUE: '已逾期',
  RETURNED: '已归还',
  CANCELLED: '已取消',
};

export function RentalPanel({
  token,
  storeId,
  staffAccountId,
}: {
  token: string;
  storeId: string;
  staffAccountId: string;
}) {
  const [items, setItems] = useState<RentalView[]>([]);
  const [status, setStatus] = useState('正在加载…');
  const [busy, setBusy] = useState('');
  const [pickupCodes, setPickupCodes] = useState<Record<string, string>>({});
  const mounted = useRef(false);
  const requestSequence = useRef(0);
  const actionInFlight = useRef(false);
  const scope = `${staffAccountId}:${storeId}:${token}`;
  const visibleScope = useRef(scope);
  visibleScope.current = scope;

  const refresh = useCallback(
    async (confirmedAction = false) => {
      const sequence = ++requestSequence.current;
      const accept = () =>
        mounted.current && visibleScope.current === scope && sequence === requestSequence.current;
      try {
        const result = await loadRentals(token, storeId);
        if (!accept()) return;
        if (result.items.some((item) => item.storeId !== storeId))
          throw new Error('租借记录与当前门店不符');
        for (const item of result.items) {
          for (const action of ['borrow', 'return'] as const) {
            if (
              (action === 'borrow' && item.status !== 'BORROWED') ||
              (action === 'return' && item.status !== 'RETURNED')
            )
              continue;
            const pendingKey = pendingRentalActionKey(staffAccountId, storeId, item.id, action);
            if (pendingKey)
              clearRentalActionKey(staffAccountId, storeId, item.id, action, pendingKey);
          }
        }
        setItems(result.items);
        setStatus(result.items.length ? '当前门店租借记录已加载' : '当前门店暂无租借记录');
      } catch (e) {
        if (!accept()) return;
        setItems([]);
        setStatus(
          confirmedAction
            ? '操作已成功确认，但列表刷新失败；请点击刷新记录。'
            : e instanceof Error
              ? `加载失败：${e.message}`
              : '加载失败',
        );
      }
    },
    [staffAccountId, storeId, token, scope],
  );

  useEffect(() => {
    mounted.current = true;
    setItems([]);
    setBusy('');
    setStatus('正在加载…');
    setPickupCodes({});
    void refresh();
    return () => {
      mounted.current = false;
      requestSequence.current++;
    };
  }, [refresh]);

  const act = async (id: string, action: 'borrow' | 'return') => {
    if (actionInFlight.current) return;
    const item = items.find((row) => row.id === id && row.storeId === storeId);
    if (
      !item ||
      (action === 'borrow' && item.status !== 'RESERVED') ||
      (action === 'return' && item.status !== 'BORROWED' && item.status !== 'OVERDUE')
    )
      return;
    const pickupCode = pickupCodes[id]?.trim();
    if (action === 'borrow' && !/^\d{6}$/.test(pickupCode ?? '')) {
      setStatus('借出前请输入顾客出示的 6 位取书码');
      return;
    }
    actionInFlight.current = true;
    setBusy(id);
    let submitted = false;
    try {
      const key = getOrCreateRentalActionKey(staffAccountId, storeId, id, action);
      submitted = true;
      const result = await rentalAction(token, id, action, key, pickupCode);
      if (
        result.id !== id ||
        result.storeId !== storeId ||
        result.status !== (action === 'borrow' ? 'BORROWED' : 'RETURNED')
      )
        throw new Error('RENTAL_ACTION_CONTEXT_MISMATCH');
      clearRentalActionKey(staffAccountId, storeId, id, action, key);
      if (!mounted.current || visibleScope.current !== scope) return;
      setStatus('操作成功');
      setPickupCodes((current) => ({ ...current, [id]: '' }));
      await refresh(true);
    } catch {
      if (mounted.current && visibleScope.current === scope)
        setStatus(
          !submitted
            ? '无法安全保存操作请求键，已阻止提交；请检查浏览器会话存储。'
            : '操作结果未确认，请先刷新记录；若仍可操作，重试将沿用原请求键。',
        );
    } finally {
      actionInFlight.current = false;
      if (mounted.current && visibleScope.current === scope) setBusy('');
    }
  };

  return (
    <section className="panel">
      <span className="tag">M16 Pickup Verification + M15 Rental</span>
      <h2>门店租借</h2>
      <p>
        当前只加载工作台选中的门店。取书码只由顾客端显示；员工现场输入 6
        位码，服务端再次校验门店范围、库存与状态。
      </p>
      <button type="button" disabled={Boolean(busy)} onClick={() => void refresh()}>
        刷新记录
      </button>
      <div className="data-table-scroll" role="region" aria-label="门店租借记录表格" tabIndex={0}>
        <table className="data-table data-table-compact">
          <thead>
            <tr>
              <th scope="col">租借单号 / 门店</th>
              <th scope="col">状态</th>
              <th scope="col">到期时间</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong className="cell-title">{item.rentalNumber}</strong>
                  <small className="cell-meta">{item.storeName}</small>
                </td>
                <td>
                  <span className="status-pill">{labels[item.status] ?? item.status}</span>
                </td>
                <td>{item.dueAt ? new Date(item.dueAt).toLocaleString() : '—'}</td>
                <td>
                  <div className="inline-actions">
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
                        <button
                          disabled={busy === item.id}
                          onClick={() => void act(item.id, 'borrow')}
                        >
                          核验并借出
                        </button>
                      </>
                    )}
                    {(item.status === 'BORROWED' || item.status === 'OVERDUE') && (
                      <button
                        disabled={busy === item.id}
                        onClick={() => void act(item.id, 'return')}
                      >
                        确认归还
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={4} className="data-table-empty">
                  当前门店暂无租借记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p role="status">{status}</p>
    </section>
  );
}
