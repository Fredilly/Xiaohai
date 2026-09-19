import { useEffect, useState, type FormEvent } from 'react';
import { loadHqOrder, loadHqOrders, loadHqUser, loadHqUsers } from './hq-support-api';

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

  const refresh = async (filters: { status?: string; q?: string } = {}) => {
    try {
      setStatus('正在读取订单…');
      const result = await loadHqOrders(token, {
        status: filters.status as Parameters<typeof loadHqOrders>[1]['status'],
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
    const orderStatus = text(form, 'status');
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
        <span className="badge">M20-B · orders.read + GLOBAL</span>
        <h2>HQ 订单支持视图</h2>
        <p>订单价格、商品与地址均读取服务端快照；本页只读，不新增订单状态写入口。</p>
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
                {value}
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
        <div className="module-grid">
          {orders.map((order) => (
            <button key={order.id} onClick={() => void open(order.id)}>
              <strong>{order.orderNumber}</strong>
              <span>{order.status}</span>
              <span>¥{(order.totalMinor / 100).toFixed(2)}</span>
              <small>{new Date(order.createdAt).toLocaleString()}</small>
            </button>
          ))}
        </div>
        {!orders.length && <p>当前筛选条件下没有订单。</p>}
      </section>

      {detail && (
        <section className="panel">
          <h3>订单详情 · {detail.orderNumber}</h3>
          <div className="context">
            <p>Consumer: {detail.consumerUserId}</p>
            <p>
              状态：{detail.status} · 总额：¥{(detail.totalMinor / 100).toFixed(2)}
            </p>
            <p>
              支付：{detail.payment ? `${detail.payment.status} · ¥${(detail.payment.amountMinor / 100).toFixed(2)}` : '无'}
            </p>
            <p>
              履约：{detail.fulfillment ? `${detail.fulfillment.method} · ${detail.fulfillment.status}` : '未创建'}
            </p>
            {detail.address && (
              <p>
                地址快照：{detail.address.region} {detail.address.city} {detail.address.district}{' '}
                {detail.address.addressLine} · {detail.address.recipientName} · {detail.address.phone}
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
        <span className="badge">M20-B · users.read + GLOBAL</span>
        <h2>Consumer 支持视图</h2>
        <p>
          只展示最小必要身份元数据与订单汇总；不返回 OpenID、UnionID、provider secret 或其他原始微信身份值。
        </p>
        <form className="ops-form compact-form" onSubmit={(event) => void submit(event)}>
          <input name="id" placeholder="Consumer UUID（可选）" />
          <button>查询</button>
        </form>
        <p>{status}</p>
      </section>

      <section className="panel">
        <h3>用户列表</h3>
        <div className="module-grid">
          {users.map((user) => (
            <button key={user.id} onClick={() => void open(user.id)}>
              <strong>{user.id}</strong>
              <span>身份绑定：{user.identityCount}</span>
              <small>
                最近登录：{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '无'}
              </small>
            </button>
          ))}
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
