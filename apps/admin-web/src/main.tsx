import { StrictMode, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { StaffMeResponse } from '@xiaohai/contracts';
import './styles.css';
import { CmsManager } from './cms-manager';
import { CatalogManager } from './catalog-manager';
import { PaymentsManager } from './payments-manager';
import { ContentManager } from './content-manager';
import { AiManager } from './ai-manager';
import { FranchiseManager } from './franchise-manager';
import { CommissionManager } from './commission-manager';
import { HqDashboard } from './hq-dashboard';
import { HqOperationsManager } from './hq-operations-manager';
import { HqSupportManager } from './hq-support-manager';
import { StaffAdminManager } from './staff-admin-manager';
import { getStaffMe, loginStaff } from './staff-auth';
import { adminModules } from './mock-data';

const tokenKey = 'staff_session_token';

function Login({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [status, setStatus] = useState('请使用 Staff Account 登录');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const loginIdentifier = f.get('loginIdentifier'),
      password = f.get('password');
    if (typeof loginIdentifier !== 'string' || typeof password !== 'string') return;
    setBusy(true);
    try {
      const r = await loginStaff(loginIdentifier, password);
      sessionStorage.setItem(tokenKey, r.session.token);
      onSignedIn(r.session.token);
    } catch {
      setStatus('登录失败，请检查账号、密码与 API 状态');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark">小海童话 · HQ</div>
        <h1>总部运营后台</h1>
        <p className="muted">真实权限始终由服务端 RBAC + Data Scope 决定。</p>
        <form onSubmit={(e) => void submit(e)}>
          <label>
            登录账号
            <input name="loginIdentifier" required minLength={3} />
          </label>
          <label>
            密码
            <input name="password" type="password" required minLength={8} />
          </label>
          <button disabled={busy}>{busy ? '登录中…' : '登录后台'}</button>
        </form>
        <p>{status}</p>
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
  const initial = window.location.hash.replace('#/', '') || 'dashboard';
  const [active, setActive] = useState(initial);
  useEffect(() => {
    const sync = () => setActive(window.location.hash.replace('#/', '') || 'dashboard');
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const visibleModules = useMemo(
    () =>
      adminModules.filter(
        (item) => !item.requiredPermission || me.permissions.includes(item.requiredPermission),
      ),
    [me.permissions],
  );
  const module = useMemo(
    () => adminModules.find((item) => item.key === active) ?? adminModules[0]!,
    [active],
  );

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <strong>小海童话</strong>
          <span>总部后台</span>
        </div>
        <nav>
          {visibleModules.map((item) => (
            <button
              className={item.key === active ? 'nav-active' : ''}
              key={item.key}
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
            <span className="eyebrow">HQ WORKSPACE</span>
            <h1>{module.label}</h1>
          </div>
          <div className="staff-chip">
            <span>{me.staff.loginIdentifier}</span>
            <button onClick={onLogout}>退出</button>
          </div>
        </header>
        {active === 'dashboard' ? (
          <HqDashboard token={token} me={me} modules={visibleModules} />
        ) : active === 'stores' ? (
          <HqOperationsManager token={token} me={me} mode="stores" />
        ) : active === 'inventory' ? (
          <HqOperationsManager token={token} me={me} mode="inventory" />
        ) : active === 'orders' ? (
          <HqSupportManager token={token} mode="orders" />
        ) : active === 'users' ? (
          <HqSupportManager token={token} mode="users" />
        ) : active === 'rental' ? (
          <HqOperationsManager token={token} me={me} mode="rental" />
        ) : active === 'fulfillment' ? (
          <HqOperationsManager token={token} me={me} mode="fulfillment" />
        ) : active === 'staff' ? (
          <StaffAdminManager token={token} />
        ) : active === 'cms' ? (
          <CmsManager token={token} />
        ) : active === 'finance' ? (
          <PaymentsManager token={token} />
        ) : active === 'catalog' ? (
          <CatalogManager token={token} />
        ) : active === 'content' ? (
          <ContentManager token={token} />
        ) : active === 'ai' ? (
          <AiManager token={token} />
        ) : active === 'franchise' ? (
          <FranchiseManager token={token} staffId={me.staff.id} />
        ) : active === 'commission' ? (
          <CommissionManager token={token} />
        ) : (
          <Preview title={module.label} description={module.description} me={me} />
        )}
      </main>
    </div>
  );
}

function Preview({
  title,
  description,
  me,
}: {
  title: string;
  description: string;
  me: StaffMeResponse;
}) {
  return (
    <section className="panel preview">
      <span className="badge">M20 待接入</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="empty-state">
        <strong>不伪造正式能力</strong>
        <span>对应 API、数据库与写操作会在 M20 所属阶段补齐。</span>
      </div>
      {title === 'Staff / 权限' && (
        <div className="context">
          <p>Permissions: {me.permissions.join(' · ') || '暂无'}</p>
          <p>
            Data Scopes:{' '}
            {me.dataScopes
              .map((scope) => `${scope.type}${scope.id ? `:${scope.id}` : ''}`)
              .join(' · ') || '暂无'}
          </p>
        </div>
      )}
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
      .then((r) => {
        if (!r) {
          sessionStorage.removeItem(tokenKey);
          setToken(null);
          setMe(null);
        } else setMe(r);
      })
      .catch(() => setMe(null))
      .finally(() => setChecking(false));
  }, [token]);
  const logout = () => {
    sessionStorage.removeItem(tokenKey);
    setToken(null);
    setMe(null);
  };
  if (checking) return <main className="center-state">正在验证 Staff Session…</main>;
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
