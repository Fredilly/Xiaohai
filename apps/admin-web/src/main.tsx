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
import { FinanceManager } from './finance-manager';
import { HqDashboard } from './hq-dashboard';
import { HqOperationsManager } from './hq-operations-manager';
import { HqSupportManager } from './hq-support-manager';
import { StaffAdminManager } from './staff-admin-manager';
import { SystemManager } from './system-manager';
import { getStaffMe, loginStaff } from './staff-auth';
import { adminModules } from './mock-data';
import { NavIcon } from './nav-icon';

const tokenKey = 'staff_session_token';

function Login({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [status, setStatus] = useState('');
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
      setStatus('无法登录，请检查账号和密码，或稍后重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark">小海童话 · 总部</div>
        <h1>总部运营后台</h1>
        <p className="muted">统一管理门店、商品与日常运营。</p>
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
        {status && (
          <p className="form-error" role="alert">
            {status}
          </p>
        )}
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
    () => visibleModules.find((item) => item.key === active) ?? visibleModules[0]!,
    [active, visibleModules],
  );
  const current = visibleModules.some((item) => item.key === active) ? active : module.key;
  const groups = [
    { label: '概览', keys: ['dashboard'] },
    {
      label: '业务',
      keys: ['stores', 'catalog', 'inventory', 'orders', 'users', 'rental', 'fulfillment'],
    },
    { label: '内容', keys: ['content', 'ai', 'cms'] },
    { label: '商业', keys: ['franchise', 'payments', 'commission', 'finance'] },
    { label: '系统', keys: ['staff', 'system'] },
  ];

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <strong>小海童话</strong>
          <span>总部运营后台</span>
        </div>
        <nav aria-label="总部功能导航">
          {groups.map((group) => {
            const items = visibleModules.filter((item) => group.keys.includes(item.key));
            return items.length ? (
              <div className="nav-group" key={group.label}>
                <span className="nav-group-title">{group.label}</span>
                {items.map((item) => (
                  <button
                    className={item.key === current ? 'nav-active' : ''}
                    aria-current={item.key === current ? 'page' : undefined}
                    key={item.key}
                    onClick={() => {
                      window.location.hash = `#/${item.key}`;
                    }}
                  >
                    <NavIcon name={item.key} />
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null;
          })}
        </nav>
      </aside>
      <main className="workspace">
        <header>
          <div>
            <span className="eyebrow">
              总部运营 / {groups.find((group) => group.keys.includes(current))?.label}
            </span>
            <h1>{module.label}</h1>
          </div>
          <div className="staff-chip">
            <span>{me.staff.loginIdentifier}</span>
            <button onClick={onLogout}>退出</button>
          </div>
        </header>
        {current === 'dashboard' ? (
          <HqDashboard token={token} me={me} modules={visibleModules} />
        ) : current === 'stores' ? (
          <HqOperationsManager token={token} me={me} mode="stores" />
        ) : current === 'inventory' ? (
          <HqOperationsManager token={token} me={me} mode="inventory" />
        ) : current === 'orders' ? (
          <HqSupportManager token={token} mode="orders" />
        ) : current === 'users' ? (
          <HqSupportManager token={token} mode="users" />
        ) : current === 'rental' ? (
          <HqOperationsManager token={token} me={me} mode="rental" />
        ) : current === 'fulfillment' ? (
          <HqOperationsManager token={token} me={me} mode="fulfillment" />
        ) : current === 'staff' ? (
          <StaffAdminManager
            token={token}
            currentStaffId={me.staff.id}
            canManage={me.permissions.includes('staff.manage')}
          />
        ) : current === 'system' ? (
          <SystemManager token={token} me={me} modules={visibleModules} />
        ) : current === 'cms' ? (
          <CmsManager token={token} />
        ) : current === 'finance' ? (
          <FinanceManager
            token={token}
            canReconcile={me.permissions.includes('finance.reconcile')}
            canExport={me.permissions.includes('finance.export')}
          />
        ) : current === 'payments' ? (
          <PaymentsManager token={token} />
        ) : current === 'catalog' ? (
          <CatalogManager token={token} />
        ) : current === 'content' ? (
          <ContentManager token={token} />
        ) : current === 'ai' ? (
          <AiManager token={token} />
        ) : current === 'franchise' ? (
          <FranchiseManager token={token} staffId={me.staff.id} />
        ) : current === 'commission' ? (
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
      <span className="badge">暂未开放</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="empty-state">
        <strong>当前版本暂无可用操作</strong>
        <span>此功能开放后可在这里使用。</span>
      </div>
      {title === 'Staff / 权限' && (
        <div className="context">
          <p>可用权限：{me.permissions.length} 项</p>
          <p>
            授权范围：{' '}
            {me.dataScopes
              .map((scope) =>
                scope.type === 'GLOBAL'
                  ? '全部数据'
                  : scope.type === 'STORE'
                    ? '指定门店'
                    : '指定区域',
              )
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
  const [authError, setAuthError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    if (!token) {
      setChecking(false);
      setMe(null);
      setAuthError(false);
      return;
    }
    setChecking(true);
    setAuthError(false);
    void getStaffMe(token)
      .then((r) => {
        if (!r) {
          sessionStorage.removeItem(tokenKey);
          setToken(null);
          setMe(null);
        } else setMe(r);
      })
      .catch(() => {
        setMe(null);
        setAuthError(true);
      })
      .finally(() => setChecking(false));
  }, [token, retryKey]);
  const logout = () => {
    sessionStorage.removeItem(tokenKey);
    setToken(null);
    setMe(null);
  };
  if (!token) return <Login onSignedIn={setToken} />;
  if (checking) return <main className="login-page">正在确认登录状态…</main>;
  if (!me && authError)
    return (
      <main className="login-page">
        <section className="login-card">
          <h1>暂时无法进入后台</h1>
          <p>无法确认登录状态，请检查网络后重试。</p>
          <div className="button-row">
            <button onClick={() => setRetryKey((value) => value + 1)}>重试</button>
            <button onClick={logout}>退出登录</button>
          </div>
        </section>
      </main>
    );
  if (!me) return <Login onSignedIn={setToken} />;
  return <Shell me={me} token={token} onLogout={logout} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
