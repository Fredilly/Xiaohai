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
  const module = useMemo(
    () => adminModules.find((i) => i.key === active) ?? adminModules[0]!,
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
          {adminModules.map((i) => (
            <button
              className={i.key === active ? 'nav-active' : ''}
              key={i.key}
              onClick={() => {
                window.location.hash = `#/${i.key}`;
              }}
            >
              {i.label}
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
          <Dashboard me={me} />
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
        ) : (
          <Preview title={module.label} description={module.description} me={me} />
        )}
      </main>
    </div>
  );
}
function Dashboard({ me }: { me: StaffMeResponse }) {
  return (
    <>
      <section className="hero">
        <div>
          <span className="badge">Production milestones</span>
          <h2>M4–M17 production modules</h2>
          <p>商城、支付、内容、AI、门店、租借、履约与加盟能力按服务端权限和状态机运行。</p>
        </div>
        <div className="hero-note">
          <strong>{me.permissions.length}</strong> permissions ·{' '}
          <strong>{me.dataScopes.length}</strong> scopes
        </div>
      </section>
      <section className="panel">
        <h3>模块接入状态</h3>
        <div className="module-grid">
          {adminModules.slice(1).map((i) => (
            <button
              key={i.key}
              onClick={() => {
                window.location.hash = `#/${i.key}`;
              }}
            >
              <strong>{i.label}</strong>
              <span>{i.description}</span>
              <em>{i.status}</em>
            </button>
          ))}
        </div>
      </section>
    </>
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
      <span className="badge">未进入当前里程碑</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="empty-state">
        <strong>不伪造正式能力</strong>
        <span>对应 API、数据库与写操作将在所属里程碑实现。</span>
      </div>
      {title === 'Staff / 权限' && (
        <div className="context">
          <p>Permissions: {me.permissions.join(' · ') || '暂无'}</p>
          <p>
            Data Scopes:{' '}
            {me.dataScopes.map((s) => `${s.type}${s.id ? `:${s.id}` : ''}`).join(' · ') || '暂无'}
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
