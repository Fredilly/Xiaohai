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
      setStatus('正在加载员工与权限…');
      const [staffResult, roleResult, permissionResult] = await Promise.all([
        loadStaffAccounts(token, { ...filters, limit: 100 }),
        loadStaffRoles(token),
        loadStaffPermissions(token),
      ]);
      setStaff(staffResult.items);
      setRoles(roleResult.items);
      setPermissions(permissionResult.items);
      setStatus(
        `已加载 ${staffResult.items.length} 个员工账号、${roleResult.items.length} 个角色、${permissionResult.items.length} 个权限`,
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
      setStatus('正在创建员工账号…');
      const created = await createStaffAccount(token, {
        loginIdentifier,
        password,
        enabled: data.get('enabled') === 'on',
      });
      form.reset();
      await refresh();
      setDetail(created);
      setStatus(`${created.loginIdentifier} 已创建，请继续分配角色与授权范围。`);
    } catch (error) {
      setStatus(error instanceof Error ? `创建失败：${error.message}` : '创建失败');
    }
  }

  async function toggleEnabled() {
    if (!detail) return;
    if (
      !window.confirm(
        detail.enabled
          ? `确定停用 ${detail.loginIdentifier}？`
          : `确定启用 ${detail.loginIdentifier}？`,
      )
    )
      return;
    try {
      setStatus('正在更新账号状态…');
      const updated = await setStaffEnabled(token, detail.id, !detail.enabled);
      setDetail(updated);
      await refresh();
      setStatus(`账号已${updated.enabled ? '启用' : '停用'}。`);
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
      setStatus('正在更新角色…');
      const updated = await replaceStaffRoles(token, detail.id, { roleIds });
      setDetail(updated);
      await refresh();
      setStatus('角色已更新。');
    } catch (error) {
      setStatus(error instanceof Error ? `Role 更新失败：${error.message}` : 'Role 更新失败');
    }
  }

  async function saveScopes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    try {
      const dataScopes = parseScopes(text(new FormData(event.currentTarget), 'dataScopes'));
      setStatus('正在更新授权范围…');
      const updated = await replaceStaffDataScopes(token, detail.id, { dataScopes });
      setDetail(updated);
      await refresh();
      setStatus('授权范围已更新。');
    } catch (error) {
      setStatus(error instanceof Error ? `Scope 更新失败：${error.message}` : 'Scope 更新失败');
    }
  }

  return (
    <>
      <section className="panel">
        <span className="badge">员工管理</span>
        <h2>员工与权限</h2>
        <p>管理员工账号、角色与授权范围。当前账号无法修改自身的关键权限。</p>
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
          <h3>创建员工账号</h3>
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
            <button>创建员工账号</button>
          </form>
          <p className="muted">新账号创建后，需要分配角色与授权范围才能使用相应功能。</p>
        </section>
      )}

      <section className="panel">
        <h3>员工账号</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>登录账号</th>
                <th>状态</th>
                <th>角色</th>
                <th>授权范围</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((account) => (
                <tr key={account.id}>
                  <td>
                    <strong>{account.loginIdentifier}</strong>
                  </td>
                  <td>{account.enabled ? '启用' : '停用'}</td>
                  <td>{account.roles.map((role) => role.key).join(' · ') || '无'}</td>
                  <td>{formatScopes(account.dataScopes)}</td>
                  <td>
                    <button onClick={() => void open(account.id)}>查看详情</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!staff.length && <p>当前筛选条件下没有员工账号。</p>}
      </section>

      {detail && (
        <section className="panel">
          <h3>员工详情 · {detail.loginIdentifier}</h3>
          <div className="context">
            <details>
              <summary>账号编号</summary>
              <code>{detail.id}</code>
            </details>
            <p>状态：{detail.enabled ? '启用' : '停用'}</p>
            <p>角色：{detail.roles.map((role) => role.key).join(' · ') || '无'}</p>
            <p>授权范围：{formatScopes(detail.dataScopes)}</p>
            <details>
              <summary>查看授权对象编号</summary>
              <code>{scopeLines(detail.dataScopes) || '无'}</code>
            </details>
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
                  {detail.enabled ? '停用账号' : '启用账号'}
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
                <strong>角色</strong>
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
                <button disabled={detail.id === currentStaffId}>更新角色</button>
              </form>

              <form
                key={`${detail.id}:${detail.updatedAt}:scopes`}
                className="ops-form"
                onSubmit={(event) => void saveScopes(event)}
              >
                <label>
                  授权范围（每行一个）
                  <textarea
                    name="dataScopes"
                    defaultValue={scopeLines(detail.dataScopes)}
                    disabled={detail.id === currentStaffId}
                    placeholder={'GLOBAL\nSTORE:00000000-0000-4000-8000-000000000000'}
                  />
                </label>
                <small>全部数据权限必须单独填写；指定区域、加盟商或门店时需填写其真实编号。</small>
                <button disabled={detail.id === currentStaffId}>更新授权范围</button>
              </form>
            </>
          )}
        </section>
      )}

      <section className="panel">
        <h3>角色与权限</h3>
        <div className="module-grid">
          {roles.map((role) => (
            <div className="empty-state" key={role.id}>
              <strong>{role.displayName}</strong>
              <details>
                <summary>角色标识</summary>
                <code>{role.key}</code>
              </details>
              <small>
                {role.permissions
                  .map((permission) => permission.displayName || permission.key)
                  .join(' · ') || '无权限'}
              </small>
            </div>
          ))}
        </div>
        <p>
          权限目录：
          {permissions.map((permission) => permission.displayName || permission.key).join(' · ') ||
            '暂无'}
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
  const names = {
    GLOBAL: '全部数据',
    REGION: '指定区域',
    FRANCHISEE: '指定加盟商',
    STORE: '指定门店',
  };
  return scopes.map((scope) => names[scope.type]).join(' · ') || '无';
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
