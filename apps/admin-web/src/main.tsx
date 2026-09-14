import { StrictMode, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { loginStaff } from './staff-auth';

function App() {
  const [status, setStatus] = useState('尚未登录 / Not signed in');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    const loginIdentifier = form.get('loginIdentifier');
    const password = form.get('password');
    if (typeof loginIdentifier !== 'string' || typeof password !== 'string') return;
    setIsSubmitting(true);
    try {
      const result = await loginStaff(loginIdentifier, password);
      sessionStorage.setItem('staff_session_token', result.session.token);
      setStatus(`已登录 / Signed in: ${result.staff.loginIdentifier}`);
      target.reset();
    } catch {
      setStatus('登录失败 / Sign-in failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main>
      <h1>小海童话总部后台</h1>
      <p>员工登录 / Staff sign-in</p>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          登录账号 / Login identifier
          <input name="loginIdentifier" autoComplete="username" required minLength={3} />
        </label>
        <label>
          密码 / Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
          />
        </label>
        <button disabled={isSubmitting}>{isSubmitting ? '登录中…' : '登录 / Sign in'}</button>
      </form>
      <p role="status">{status}</p>
    </main>
  );
}

const root = document.querySelector<HTMLDivElement>('#root');
if (!root) throw new Error('Root element is missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
