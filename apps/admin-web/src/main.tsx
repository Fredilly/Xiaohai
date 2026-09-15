import { StrictMode, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { StaffMeResponse } from '@xiaohai/contracts';
import './styles.css';
import { getStaffMe, loginStaff } from './staff-auth';
import { adminModules } from './mock-data';

const tokenKey = 'staff_session_token';

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
  return <main className="login-page"><section className="login-card"><div className="brand-mark">小海童话 · HQ</div><h1>总部运营后台</h1><p className="muted">统一管理内容、门店与业务运营。真实权限始终由服务端 RBAC + Data Scope 决定。</p><form onSubmit={(event) => void submit(event)}><label>登录账号<input name="loginIdentifier" autoComplete="username" required minLength={3} /></label><label>密码<input name="password" type="password" autoComplete="current-password" required minLength={8} /></label><button disabled={busy}>{busy ? '登录中…' : '登录后台'}</button></form><p role="status" className="status-line">{status}</p></section></main>;
}

function Shell({ me, onLogout }: { me: StaffMeResponse; onLogout: () => void }) {
  const initial = window.location.hash.replace('#/', '') || 'dashboard';
  const [active, setActive] = useState(initial);
  useEffect(() => { const sync = () => setActive(window.location.hash.replace('#/', '') || 'dashboard'); window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync); }, []);
  const module = useMemo(() => adminModules.find((item) => item.key === active) ?? adminModules[0]!, [active]);
  const go = (key: string) => { window.location.hash = `#/${key}`; };
  return <div className="shell"><aside><div className="brand"><strong>小海童话</strong><span>总部后台</span></div><nav aria-label="总部模块">{adminModules.map((item) => <button className={item.key === active ? 'nav-active' : ''} key={item.key} onClick={() => go(item.key)}>{item.label}</button>)}</nav></aside><main className="workspace"><header><div><span className="eyebrow">HQ WORKSPACE</span><h1>{module.label}</h1></div><div className="staff-chip"><span>{me.staff.loginIdentifier}</span><button onClick={onLogout}>退出</button></div></header>{active === 'dashboard' ? <Dashboard me={me} /> : <Preview title={module.label} description={module.description} me={me} />}</main></div>;
}

function Dashboard({ me }: { me: StaffMeResponse }) {
  return <><section className="hero"><div><span className="badge">前端 Sprint</span><h2>运营框架已就位，业务能力按里程碑接入</h2><p>这里的业务数字均为前端演示状态，不代表真实订单、库存或财务数据。</p></div><div className="hero-note">服务端授权上下文<br/><strong>{me.permissions.length}</strong> permissions · <strong>{me.dataScopes.length}</strong> scopes</div></section><section className="stats"><article><span>今日待办</span><strong>—</strong><small>等待正式业务 API</small></article><article><span>门店网络</span><strong>Preview</strong><small>组织 API 尚未实现</small></article><article><span>订单中心</span><strong>Preview</strong><small>订单 API 尚未实现</small></article></section><section className="panel"><h3>模块接入状态</h3><div className="module-grid">{adminModules.slice(1).map((item) => <button key={item.key} onClick={() => { window.location.hash = `#/${item.key}`; }}><strong>{item.label}</strong><span>{item.description}</span><em>{item.status}</em></button>)}</div></section></>;
}

function Preview({ title, description, me }: { title: string; description: string; me: StaffMeResponse }) {
  return <section className="panel preview"><span className="badge">Frontend preview · 非真实业务数据</span><h2>{title}</h2><p>{description}</p><div className="empty-state"><strong>页面框架已准备</strong><span>正式 API、数据库业务模型与写操作将在对应里程碑实现。当前页面不会模拟支付成功、库存扣减或真实财务入账。</span></div>{title === 'Staff / 权限' && <div className="context"><h3>当前服务端授权上下文</h3><p>Permissions: {me.permissions.length ? me.permissions.join(' · ') : '暂无'}</p><p>Data Scopes: {me.dataScopes.length ? me.dataScopes.map((scope) => `${scope.type}${scope.id ? `:${scope.id}` : ''}`).join(' · ') : '暂无'}</p><small>这些值来自 GET /api/v1/staff/me，仅用于展示；前端可见性不是授权边界。</small></div>}</section>;
}

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenKey));
  const [me, setMe] = useState<StaffMeResponse | null>(null);
  const [checking, setChecking] = useState(Boolean(token));
  useEffect(() => { if (!token) { setChecking(false); setMe(null); return; } setChecking(true); void getStaffMe(token).then((result) => { if (!result) { sessionStorage.removeItem(tokenKey); setToken(null); setMe(null); } else setMe(result); }).catch(() => setMe(null)).finally(() => setChecking(false)); }, [token]);
  const logout = () => { sessionStorage.removeItem(tokenKey); setToken(null); setMe(null); };
  if (checking) return <main className="center-state">正在验证 Staff Session…</main>;
  if (!token || !me) return <Login onSignedIn={setToken} />;
  return <Shell me={me} onLogout={logout} />;
}

const root = document.querySelector<HTMLDivElement>('#root');
if (!root) throw new Error('Root element is missing');
createRoot(root).render(<StrictMode><App /></StrictMode>);
