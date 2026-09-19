import { StrictMode, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { StaffMeResponse } from '@xiaohai/contracts';
import type { StaffStore } from '@xiaohai/contracts/stores';
import './styles.css';
import { getStaffMe, loginStaff } from './staff-auth';
import { loadStaffStores } from './stores-api';
import { storeModules } from './mock-data';
import { InventoryPanel } from './inventory-panel';
import { RentalPanel } from './rental-panel';
import { FulfillmentPanel } from './fulfillment-panel';

const tokenKey = 'staff_session_token';
const selectedStoreKey = 'staff_selected_store_id';

function Login({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [status, setStatus] = useState('请使用 Staff Account 登录');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const loginIdentifier = form.get('loginIdentifier');
    const password = form.get('password');
    if (typeof loginIdentifier !== 'string' || typeof password !== 'string') return;
    setBusy(true);
    try {
      const result = await loginStaff(loginIdentifier, password);
      sessionStorage.setItem(tokenKey, result.session.token);
      onSignedIn(result.session.token);
    } catch {
      setStatus('登录失败，请检查账号、密码与 API 状态');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-card">
        <span className="eyebrow">PANGZHU STORE</span>
        <h1>胖竹门店工作台</h1>
        <p>登录后进入门店工作台。门店范围与权限始终由服务端授权上下文决定。</p>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            登录账号
            <input name="loginIdentifier" autoComplete="username" required minLength={3} />
          </label>
          <label>
            密码
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
            />
          </label>
          <button disabled={busy}>{busy ? '登录中…' : '进入工作台'}</button>
        </form>
        <p role="status">{status}</p>
      </section>
    </main>
  );
}

function Shell({
  me,
  token,
  onLogout,
}: {
  me: StaffMeResponse;
  token: string;
  onLogout: () => void;
}) {
  const [active, setActive] = useState(window.location.hash.replace('#/', '') || 'dashboard');
  const [stores, setStores] = useState<StaffStore[]>([]);
  const [storeId, setStoreId] = useState(() => sessionStorage.getItem(selectedStoreKey) ?? '');
  const [storeStatus, setStoreStatus] = useState('正在加载授权门店…');

  useEffect(() => {
    const sync = () => setActive(window.location.hash.replace('#/', '') || 'dashboard');
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  useEffect(() => {
    let activeRequest = true;
    void loadStaffStores(token)
      .then((result) => {
        if (!activeRequest) return;
        setStores(result.stores);
        const saved = sessionStorage.getItem(selectedStoreKey) ?? '';
        const next = result.stores.some((store) => store.id === saved)
          ? saved
          : (result.stores[0]?.id ?? '');
        setStoreId(next);
        if (next) sessionStorage.setItem(selectedStoreKey, next);
        else sessionStorage.removeItem(selectedStoreKey);
        setStoreStatus(result.stores.length ? '' : '当前账号没有可访问门店');
      })
      .catch((error: unknown) => {
        if (!activeRequest) return;
        setStores([]);
        setStoreId('');
        sessionStorage.removeItem(selectedStoreKey);
        setStoreStatus(error instanceof Error ? `门店加载失败：${error.message}` : '门店加载失败');
      });
    return () => {
      activeRequest = false;
    };
  }, [token]);

  const module = useMemo(
    () => storeModules.find((item) => item.key === active) ?? storeModules[0],
    [active],
  );
  const currentStore = stores.find((store) => store.id === storeId) ?? null;

  const chooseStore = (nextStoreId: string) => {
    setStoreId(nextStoreId);
    sessionStorage.setItem(selectedStoreKey, nextStoreId);
  };

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <strong>胖竹书店</strong>
          <span>门店工作台</span>
        </div>
        <nav aria-label="门店模块">
          {storeModules.map((item) => (
            <button
              key={item.key}
              className={item.key === active ? 'active' : ''}
              onClick={() => {
                window.location.hash = `#/${item.key}`;
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="workspace">
        <header>
          <div>
            <span className="eyebrow">STORE WORKSPACE</span>
            <h1>{module.label}</h1>
          </div>
          <div className="workspace-actions">
            <label className="store-picker">
              当前门店
              <select
                value={storeId}
                disabled={!stores.length}
                onChange={(event) => chooseStore(event.target.value)}
              >
                {!stores.length && <option value="">无可用门店</option>}
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name} · {store.city}
                  </option>
                ))}
              </select>
            </label>
            <div className="identity">
              <span>{me.staff.loginIdentifier}</span>
              <button onClick={onLogout}>退出</button>
            </div>
          </div>
        </header>
        {storeStatus && <p className="store-status">{storeStatus}</p>}
        {active === 'dashboard' ? (
          <Dashboard me={me} currentStore={currentStore} />
        ) : active === 'inventory' ? (
          currentStore ? (
            <InventoryPanel token={token} storeId={currentStore.id} />
          ) : (
            <StoreRequired />
          )
        ) : active === 'rental' ? (
          currentStore ? (
            <RentalPanel token={token} storeId={currentStore.id} />
          ) : (
            <StoreRequired />
          )
        ) : active === 'orders' ? (
          currentStore ? (
            <FulfillmentPanel token={token} storeId={currentStore.id} />
          ) : (
            <StoreRequired />
          )
        ) : (
          <Preview title={module.label} description={module.description} />
        )}
      </main>
    </div>
  );
}

function Dashboard({ me, currentStore }: { me: StaffMeResponse; currentStore: StaffStore | null }) {
  return (
    <>
      <section className="hero">
        <span className="tag">M19 Store Web</span>
        <h2>{currentStore ? `${currentStore.name} 工作台` : '今天从这里开始门店工作'}</h2>
        <p>
          {currentStore
            ? `${currentStore.city} · ${currentStore.addressLine}`
            : '请先确认当前账号具有 stores.read 权限和可访问门店范围。'}
        </p>
        <div className="scope">
          服务端 Data Scope：
          {me.dataScopes.length
            ? me.dataScopes.map((item) => item.type).join(' · ')
            : '暂无授权范围'}
        </div>
      </section>
      <section className="quick-grid">
        {storeModules.slice(1).map((item) => (
          <button
            key={item.key}
            onClick={() => {
              window.location.hash = `#/${item.key}`;
            }}
          >
            <strong>{item.label}</strong>
            <span>{item.description}</span>
            <em>{item.status}</em>
          </button>
        ))}
      </section>
      <section className="notice">
        <strong>安全边界</strong>
        <p>
          当前门店选择器只决定页面查询上下文，不代表授权。每个真实业务请求仍由 API 根据 Staff Session +
          RBAC + Data Scope 校验，前端传入的 storeId 不能扩大权限。
        </p>
      </section>
    </>
  );
}

function StoreRequired() {
  return (
    <section className="panel">
      <span className="tag">Store context required</span>
      <h2>没有可用门店</h2>
      <p>当前账号没有加载到可访问门店，因此不会发起库存、租借或履约操作。</p>
    </section>
  );
}

function Preview({ title, description }: { title: string; description: string }) {
  return (
    <section className="panel">
      <span className="tag">M19 implementation pending</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="empty">
        <strong>此模块将在 M19 后续批次接入</strong>
        <span>不会用 Mock 数据冒充真实门店业务结果。</span>
      </div>
    </section>
  );
}

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenKey));
  const [me, setMe] = useState<StaffMeResponse | null>(null);
  const [checking, setChecking] = useState(Boolean(token));
  useEffect(() => {
    if (!token) {
      setChecking(false);
      setMe(null);
      return;
    }
    setChecking(true);
    void getStaffMe(token)
      .then((result) => {
        if (!result) {
          sessionStorage.removeItem(tokenKey);
          sessionStorage.removeItem(selectedStoreKey);
          setToken(null);
        } else setMe(result);
      })
      .catch(() => setMe(null))
      .finally(() => setChecking(false));
  }, [token]);
  const logout = () => {
    sessionStorage.removeItem(tokenKey);
    sessionStorage.removeItem(selectedStoreKey);
    setToken(null);
    setMe(null);
  };
  if (checking) return <main className="center">正在验证 Staff Session…</main>;
  if (!token || !me) return <Login onSignedIn={setToken} />;
  return <Shell me={me} token={token} onLogout={logout} />;
}

const root = document.querySelector<HTMLDivElement>('#root');
if (!root) throw new Error('Root element is missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
