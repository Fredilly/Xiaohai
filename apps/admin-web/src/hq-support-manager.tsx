import { useEffect, useState, type FormEvent } from 'react';
import type { HqOrderListQuery } from '@xiaohai/contracts/hq';
import { loadHqOrder, loadHqOrders, loadHqUser, loadHqUsers } from './hq-support-api';
import { displayStatus, money } from './display';

export type HqSupportMode = 'orders' | 'users';

type OrderList = Awaited<ReturnType<typeof loadHqOrders>>;
type OrderDetail = Awaited<ReturnType<typeof loadHqOrder>>;
type UserList = Awaited<ReturnType<typeof loadHqUsers>>;
type UserDetail = Awaited<ReturnType<typeof loadHqUser>>;

export function HqSupportManager({ token, mode }: { token: string; mode: HqSupportMode }) {
  return mode === 'orders' ? <OrdersManager token={token} /> : <UsersManager token={token} />;
}

function OrdersManager({ token }: { token: string }) {
  const [orders, setOrders] = useState<OrderList['items']>([]);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [status, setStatus] = useState('');

  const refresh = async (filters: { status?: HqOrderListQuery['status']; q?: string } = {}) => {
    try {
      setStatus('正在读取订单…');
      const result = await loadHqOrders(token, {
        status: filters.status,
        q: filters.q || undefined,
        limit: 100,
      });
      setOrders(result.items);
      setStatus(`已加载 ${result.items.length} 笔订单`);
    } catch (error) {
      setStatus(error instanceof Error ? `加载失败：${error.message}` : '加载失败');
    }
  };

  useEffect(() => {
    void refresh();
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const orderStatus = text(form, 'status') as HqOrderListQuery['status'] | '';
    const q = text(form, 'q');
    await refresh({ status: orderStatus || undefined, q: q || undefined });
  }

  const open = async (id: string) => {
    try {
      setDetail(await loadHqOrder(token, id));
    } catch (error) {
      setStatus(error instanceof Error ? `详情加载失败：${error.message}` : '详情加载失败');
    }
  };

  return (
    <>
      <section className="panel">
        <h2>订单查询</h2>
        <p>查询订单和下单时的商品、价格与地址信息。</p>
        <form className="ops-form compact-form" onSubmit={(event) => void submit(event)}>
          <select name="status" defaultValue="">
            <option value="">全部状态</option>
            {[
              'UNPAID',
              'PAID',
              'PROCESSING',
              'PICKUP_READY',
              'DELIVERING',
              'COMPLETED',
              'CANCELLED',
              'REFUNDING',
              'REFUNDED',
            ].map((value) => (
              <option value={value} key={value}>
                {displayStatus(value)}
              </option>
            ))}
          </select>
          <input name="q" maxLength={120} placeholder="订单号搜索" />
          <button>筛选</button>
        </form>
        <p>{status}</p>
      </section>

      <section className="panel">
        <h3>订单列表</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>订单号</th>
                <th>状态</th>
                <th>金额</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <strong>{order.orderNumber}</strong>
                  </td>
                  <td>
                    <span className="badge">{displayStatus(order.status)}</span>
                  </td>
                  <td>{money(order.totalMinor)}</td>
                  <td>{new Date(order.createdAt).toLocaleString()}</td>
                  <td>
                    <button onClick={() => void open(order.id)}>查看详情</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!orders.length && <p>当前筛选条件下没有订单。</p>}
      </section>

      {detail && (
        <section className="panel">
          <h3>订单详情 · {detail.orderNumber}</h3>
          <div className="context">
            <details>
              <summary>关联用户编号</summary>
              {detail.consumerUserId}
            </details>
            <p>
              状态：{displayStatus(detail.status)} · 总额：{money(detail.totalMinor)}
            </p>
            <p>
              支付：
              {detail.payment
                ? `${displayStatus(detail.payment.status)} · ${money(detail.payment.amountMinor)}`
                : '无'}
            </p>
            <p>
              履约：
              {detail.fulfillment
                ? `${displayStatus(detail.fulfillment.method)} · ${displayStatus(detail.fulfillment.status)}`
                : '未创建'}
            </p>
            {detail.address && (
              <p>
                地址快照：{detail.address.region} {detail.address.city} {detail.address.district}{' '}
                {detail.address.addressLine} · {detail.address.recipientName} ·{' '}
                {detail.address.phone}
              </p>
            )}
          </div>
          <div className="module-grid">
            {detail.items.map((item) => (
              <div className="empty-state" key={item.id}>
                <strong>{item.productName}</strong>
                <span>
                  {item.skuName} · {item.skuCode || '无 SKU 快照'}
                </span>
                <span>
                  {item.quantity} × ¥{(item.unitPriceMinor / 100).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function UsersManager({ token }: { token: string }) {
  const [users, setUsers] = useState<UserList['items']>([]);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [status, setStatus] = useState('');

  const refresh = async (id?: string) => {
    try {
      setStatus('正在读取用户支持记录…');
      const result = await loadHqUsers(token, { id: id || undefined, limit: 100 });
      setUsers(result.items);
      setStatus(`已加载 ${result.items.length} 个用户`);
    } catch (error) {
      setStatus(error instanceof Error ? `加载失败：${error.message}` : '加载失败');
    }
  };

  useEffect(() => {
    void refresh();
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = text(new FormData(event.currentTarget), 'id');
    await refresh(id || undefined);
  }

  const open = async (id: string) => {
    try {
      setDetail(await loadHqUser(token, id));
    } catch (error) {
      setStatus(error instanceof Error ? `详情加载失败：${error.message}` : '详情加载失败');
    }
  };

  return (
    <>
      <section className="panel">
        <h2>用户查询</h2>
        <p>查看用户的基本记录和订单汇总。</p>
        <form className="ops-form compact-form" onSubmit={(event) => void submit(event)}>
          <input name="id" placeholder="用户编号（可选）" />
          <button>查询</button>
        </form>
        <p>{status}</p>
      </section>

      <section className="panel">
        <h3>用户列表</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>用户编号</th>
                <th>身份绑定</th>
                <th>最近登录</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <code>{user.id}</code>
                  </td>
                  <td>{user.identityCount}</td>
                  <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '无'}</td>
                  <td>
                    <button onClick={() => void open(user.id)}>查看详情</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!users.length && <p>当前筛选条件下没有用户。</p>}
      </section>

      {detail && (
        <section className="panel">
          <h3>用户详情</h3>
          <div className="context">
            <p>ID：{detail.id}</p>
            <p>身份绑定数量：{detail.identityCount}</p>
            <p>订单数量：{detail.orderCount}</p>
            <p>历史订单金额：¥{(detail.lifetimeOrderMinor / 100).toFixed(2)}</p>
            <p>
              最近订单：{detail.lastOrderAt ? new Date(detail.lastOrderAt).toLocaleString() : '无'}
            </p>
          </div>
        </section>
      )}
    </>
  );
}

function text(data: FormData, field: string) {
  const value = data.get(field);
  return typeof value === 'string' ? value.trim() : '';
}
