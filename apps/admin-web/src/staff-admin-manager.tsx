import { useEffect, useState, type FormEvent } from 'react';
import {
  createStaffAccount,
  loadStaffAccount,
  loadStaffAccounts,
  loadStaffPermissions,
  loadStaffRoles,
  replaceStaffDataScopes,
  replaceStaffRoles,
  resetStaffPassword,
  setStaffEnabled,
} from './staff-admin-api';

type StaffList = Awaited<ReturnType<typeof loadStaffAccounts>>;
type StaffDetail = Awaited<ReturnType<typeof loadStaffAccount>>;
type RoleList = Awaited<ReturnType<typeof loadStaffRoles>>;
type PermissionList = Awaited<ReturnType<typeof loadStaffPermissions>>;
type StaffScope = StaffDetail['dataScopes'][number];

export function StaffAdminManager({
  token,
  currentStaffId,
  canManage,
}: {
  token: string;
  currentStaffId: string;
  canManage: boolean;
}) {
  const [staff, setStaff] = useState<StaffList['items']>([]);
  const [roles, setRoles] = useState<RoleList['items']>([]);
  const [permissions, setPermissions] = useState<PermissionList['items']>([]);
  const [detail, setDetail] = useState<StaffDetail | null>(null);
  const [status, setStatus] = useState('');

  const refresh = async (filters: { q?: string; enabled?: boolean } = {}) => {
    try {
      setStatus('正在读取 Staff / RBAC 上下文…');
      const [staffResult, roleResult, permissionResult] = await Promise.all([
        loadStaffAccounts(token, { ...filters, limit: 100 }),
        loadStaffRoles(token),
        loadStaffPermissions(token),
      ]);
      setStaff(staffResult.items);
      setRoles(roleResult.items);
      setPermissions(permissionResult.items);
      setStatus(
        `已加载 ${staffResult.items.length} 个 Staff、${roleResult.items.length} 个角色、${permissionResult.items.length} 个权限`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? `加载失败：${error.message}` : '加载失败');
    }
  };

  useEffect(() => {
    void refresh();
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const q = text(data, 'q');
    const enabled = text(data, 'enabled');
    await refresh({
      q: q || undefined,
      enabled: enabled === '' ? undefined : enabled === 'true',
    });
  }

  async function open(id: string) {
    try {
      setDetail(await loadStaffAccount(token, id));
    } catch (error) {
      setStatus(error instanceof Error ? `详情加载失败：${error.message}` : '详情加载失败');
    }
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const loginIdentifier = text(data, 'loginIdentifier');
    const password = text(data, 'password');
    if (!loginIdentifier || !password) return;
    try {
      setStatus('正在创建 Staff…');
      const created = await createStaffAccount(token, {
        loginIdentifier,
        password,
        enabled: data.get('enabled') === 'on',
      });
      form.reset();
      await refresh();
      setDetail(created);
      setStatus(`Staff ${created.loginIdentifier} 已创建；请继续分配 Role 与 Data Scope。`);
    } catch (error) {
      setStatus(error instanceof Error ? `创建失败：${error.message}` : '创建失败');
    }
  }

  async function toggleEnabled() {
    if (!detail) return;
    try {
      setStatus('正在更新 Staff 状态…');
      const updated = await setStaffEnabled(token, detail.id, !detail.enabled);
      setDetail(updated);
      await refresh();
      setStatus(`Staff 已${updated.enabled ? '启用' : '停用'}。`);
    } catch (error) {
      setStatus(error instanceof Error ? `状态更新失败：${error.message}` : '状态更新失败');
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = event.currentTarget;
    const password = text(new FormData(form), 'password');
    if (!password) return;
    try {
      setStatus('正在重置密码…');
      await resetStaffPassword(token, detail.id, password);
      form.reset();
      setStatus('密码已重置；密码明文不会返回或写入日志。');
    } catch (error) {
      setStatus(error instanceof Error ? `密码重置失败：${error.message}` : '密码重置失败');
    }
  }

  async function saveRoles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const roleIds = new FormData(event.currentTarget)
      .getAll('roleId')
      .filter((value): value is string => typeof value === 'string');
    try {
      setStatus('正在替换 Staff Roles…');
      const updated = await replaceStaffRoles(token, detail.id, { roleIds });
      setDetail(updated);
      await refresh();
      setStatus('Staff Roles 已替换。');
    } catch (error) {
      setStatus(error instanceof Error ? `Role 更新失败：${error.message}` : 'Role 更新失败');
    }
  }

  async function saveScopes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    try {
      const dataScopes = parseScopes(text(new FormData(event.currentTarget), 'dataScopes'));
      setStatus('正在替换 Data Scopes…');
      const updated = await replaceStaffDataScopes(token, detail.id, { dataScopes });
      setDetail(updated);
      await refresh();
      setStatus('Staff Data Scopes 已替换。');
    } catch (error) {
      setStatus(error instanceof Error ? `Scope 更新失败：${error.message}` : 'Scope 更新失败');
    }
  }

  return (
    <>
      <section className="panel">
        <span className="badge">M20-C · staff.read / staff.manage + GLOBAL</span>
        <h2>Staff / RBAC / Data Scope</h2>
        <p>
          Staff、角色、权限和 Data Scope 均由服务端读取与校验。写操作要求 staff.manage + GLOBAL；
          当前账号不能停用自己，也不能替换自己的 Role 或 Data Scope。密码哈希不会返回前端。
        </p>
        <form className="ops-form compact-form" onSubmit={(event) => void submit(event)}>
          <input name="q" maxLength={120} placeholder="登录账号搜索" />
          <select name="enabled" defaultValue="">
            <option value="">全部状态</option>
            <option value="true">启用</option>
            <option value="false">停用</option>
          </select>
          <button>筛选</button>
        </form>
        <p>{status}</p>
      </section>

      {canManage && (
        <section className="panel">
          <h3>创建 Staff</h3>
          <form className="ops-form" onSubmit={(event) => void createAccount(event)}>
            <label>
              登录账号
              <input name="loginIdentifier" required minLength={3} maxLength={120} />
            </label>
            <label>
              初始密码
              <input name="password" type="password" required minLength={12} maxLength={128} />
            </label>
            <label>
              <input name="enabled" type="checkbox" defaultChecked /> 创建后立即启用
            </label>
            <button>创建 Staff</button>
          </form>
          <p className="muted">新账号默认没有 Role / Data Scope，需要创建后显式分配。</p>
        </section>
      )}

      <section className="panel">
        <h3>Staff Accounts</h3>
        <div className="module-grid">
          {staff.map((account) => (
            <button key={account.id} onClick={() => void open(account.id)}>
              <strong>{account.loginIdentifier}</strong>
              <span>{account.enabled ? '启用' : '停用'}</span>
              <span>Roles: {account.roles.map((role) => role.key).join(' · ') || '无'}</span>
              <small>Scopes: {formatScopes(account.dataScopes)}</small>
            </button>
          ))}
        </div>
        {!staff.length && <p>当前筛选条件下没有 Staff。</p>}
      </section>

      {detail && (
        <section className="panel">
          <h3>Staff 详情 · {detail.loginIdentifier}</h3>
          <div className="context">
            <p>ID：{detail.id}</p>
            <p>状态：{detail.enabled ? '启用' : '停用'}</p>
            <p>Roles：{detail.roles.map((role) => role.key).join(' · ') || '无'}</p>
            <p>Data Scopes：{formatScopes(detail.dataScopes)}</p>
            <p>
              最近登录：
              {detail.lastLoginAt ? new Date(detail.lastLoginAt).toLocaleString() : '无'}
            </p>
          </div>

          {canManage && (
            <>
              <div className="compact-row">
                <button
                  disabled={detail.id === currentStaffId && detail.enabled}
                  onClick={() => void toggleEnabled()}
                >
                  {detail.enabled ? '停用 Staff' : '启用 Staff'}
                </button>
                {detail.id === currentStaffId && (
                  <small>当前登录账号禁止自我停用 / 自改 Role / 自改 Scope。</small>
                )}
              </div>

              <form className="ops-form" onSubmit={(event) => void resetPassword(event)}>
                <label>
                  新密码
                  <input name="password" type="password" required minLength={12} maxLength={128} />
                </label>
                <button>重置密码</button>
              </form>

              <form
                key={`${detail.id}:${detail.updatedAt}:roles`}
                className="ops-form"
                onSubmit={(event) => void saveRoles(event)}
              >
                <strong>Roles</strong>
                {roles.map((role) => (
                  <label key={role.id}>
                    <input
                      type="checkbox"
                      name="roleId"
                      value={role.id}
                      defaultChecked={detail.roles.some((assigned) => assigned.id === role.id)}
                      disabled={detail.id === currentStaffId}
                    />
                    {role.displayName} ({role.key})
                  </label>
                ))}
                <button disabled={detail.id === currentStaffId}>替换 Roles</button>
              </form>

              <form
                key={`${detail.id}:${detail.updatedAt}:scopes`}
                className="ops-form"
                onSubmit={(event) => void saveScopes(event)}
              >
                <label>
                  Data Scopes（每行一个）
                  <textarea
                    name="dataScopes"
                    defaultValue={scopeLines(detail.dataScopes)}
                    disabled={detail.id === currentStaffId}
                    placeholder={'GLOBAL\nSTORE:00000000-0000-4000-8000-000000000000'}
                  />
                </label>
                <small>
                  GLOBAL 必须单独使用；REGION / FRANCHISEE / STORE 后必须跟真实 UUID，服务端会验证目标是否存在。
                </small>
                <button disabled={detail.id === currentStaffId}>替换 Data Scopes</button>
              </form>
            </>
          )}
        </section>
      )}

      <section className="panel">
        <h3>Roles / Permissions</h3>
        <div className="module-grid">
          {roles.map((role) => (
            <div className="empty-state" key={role.id}>
              <strong>{role.displayName}</strong>
              <span>{role.key}</span>
              <small>
                {role.permissions.map((permission) => permission.key).join(' · ') || '无权限'}
              </small>
            </div>
          ))}
        </div>
        <p>
          Permission catalog：
          {permissions.map((permission) => permission.key).join(' · ') || '暂无'}
        </p>
      </section>
    </>
  );
}

function text(data: FormData, field: string) {
  const value = data.get(field);
  return typeof value === 'string' ? value.trim() : '';
}

function formatScopes(scopes: StaffDetail['dataScopes']) {
  return (
    scopes.map((scope) => `${scope.type}${scope.id ? `:${scope.id}` : ''}`).join(' · ') || '无'
  );
}

function scopeLines(scopes: StaffDetail['dataScopes']) {
  return scopes.map((scope) => `${scope.type}${scope.id ? `:${scope.id}` : ''}`).join('\n');
}

function parseScopes(raw: string): StaffScope[] {
  if (!raw.trim()) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line === 'GLOBAL') return { type: 'GLOBAL', id: null };
      const separator = line.indexOf(':');
      if (separator <= 0) throw new Error(`无效 Scope：${line}`);
      const type = line.slice(0, separator);
      const id = line.slice(separator + 1);
      if (!['REGION', 'FRANCHISEE', 'STORE'].includes(type) || !id) {
        throw new Error(`无效 Scope：${line}`);
      }
      return { type: type as 'REGION' | 'FRANCHISEE' | 'STORE', id };
    });
}
