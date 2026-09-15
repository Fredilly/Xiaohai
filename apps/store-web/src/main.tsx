import { StrictMode, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { StaffMeResponse } from '@xiaohai/contracts';
import './styles.css';
import { getStaffMe, loginStaff } from './staff-auth';
import { storeModules } from './mock-data';

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
    try { const result = await loginStaff(loginIdentifier, password); sessionStorage.setItem(tokenKey, result.session.token); onSignedIn(result.session.token); }
    catch { setStatus('登录失败，请检查账号、密码与 API 状态'); }
    finally { setBusy(false); }
  }
  return <main className="login-page"><section className="login-card"><span className="eyebrow">PANGZHU STORE</span><h1>胖竹门店工作台</h1><p>登录后进入门店工作台。门店范围与权限始终由服务端授权上下文决定。</p><form onSubmit={(event) => void submit(event)}><label>登录账号<input name="loginIdentifier" autoComplete="username" required minLength={3}/></label><label>密码<input name="password" type="password" autoComplete="current-password" required minLength={8}/></label><button disabled={busy}>{busy ? '登录中…' : '进入工作台'}</button></form><p role="status">{status}</p></section></main>;
}

function Shell({ me, onLogout }: { me: StaffMeResponse; onLogout: () => void }) {
  const [active, setActive] = useState(window.location.hash.replace('#/', '') || 'dashboard');
  useEffect(() => { const sync = () => setActive(window.location.hash.replace('#/', '') || 'dashboard'); window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync); }, []);
  const module = useMemo(() => storeModules.find((item) => item.key === active) ?? storeModules[0], [active]);
  return <div className="shell"><aside><div className="brand"><strong>胖竹书店</strong><span>门店工作台</span></div><nav aria-label="门店模块">{storeModules.map((item) => <button key={item.key} className={item.key === active ? 'active' : ''} onClick={() => { window.location.hash = `#/${item.key}`; }}>{item.label}</button>)}</nav></aside><main className="workspace"><header><div><span className="eyebrow">STORE WORKSPACE</span><h1>{module.label}</h1></div><div className="identity"><span>{me.staff.loginIdentifier}</span><button onClick={onLogout}>退出</button></div></header>{active === 'dashboard' ? <Dashboard me={me}/> : <Preview title={module.label} description={module.description}/>}</main></div>;
}

function Dashboard({ me }: { me: StaffMeResponse }) {
  return <><section className="hero"><span className="tag">Frontend preview</span><h2>今天从这里开始门店工作</h2><p>查询、库存、租借和履约入口已经整理；正式业务数据将在对应后端里程碑接入。</p><div className="scope">服务端 Data Scope：{me.dataScopes.length ? me.dataScopes.map((item) => item.type).join(' · ') : '暂无授权范围'}</div></section><section className="quick-grid">{storeModules.slice(1).map((item) => <button key={item.key} onClick={() => { window.location.hash = `#/${item.key}`; }}><strong>{item.label}</strong><span>{item.description}</span><em>{item.status}</em></button>)}</section><section className="notice"><strong>安全边界</strong><p>本工作台不会从 URL 或前端选择器获得真实 storeId 授权。未来真实业务请求仍必须由 API 根据 Staff Session + RBAC + Data Scope 校验。</p></section></>;
}

function Preview({ title, description }: { title: string; description: string }) {
  return <section className="panel"><span className="tag">Frontend mock / Coming soon</span><h2>{title}</h2><p>{description}</p><div className="empty"><strong>前端结构已准备</strong><span>当前没有正式业务 API，因此这里不展示伪造的真实库存、订单、租借或配送结果。</span></div></section>;
}

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenKey));
  const [me, setMe] = useState<StaffMeResponse | null>(null);
  const [checking, setChecking] = useState(Boolean(token));
  useEffect(() => { if (!token) { setChecking(false); setMe(null); return; } setChecking(true); void getStaffMe(token).then((result) => { if (!result) { sessionStorage.removeItem(tokenKey); setToken(null); } else setMe(result); }).catch(() => setMe(null)).finally(() => setChecking(false)); }, [token]);
  const logout = () => { sessionStorage.removeItem(tokenKey); setToken(null); setMe(null); };
  if (checking) return <main className="center">正在验证 Staff Session…</main>;
  if (!token || !me) return <Login onSignedIn={setToken}/>;
  return <Shell me={me} onLogout={logout}/>;
}

const root = document.querySelector<HTMLDivElement>('#root');
if (!root) throw new Error('Root element is missing');
createRoot(root).render(<StrictMode><App/></StrictMode>);
