import { useEffect, useState, type FormEvent } from 'react';
import {
  loadStaffAccount,
  loadStaffAccounts,
  loadStaffPermissions,
  loadStaffRoles,
} from './staff-admin-api';

type StaffList = Awaited<ReturnType<typeof loadStaffAccounts>>;
type StaffDetail = Awaited<ReturnType<typeof loadStaffAccount>>;
type RoleList = Awaited<ReturnType<typeof loadStaffRoles>>;
type PermissionList = Awaited<ReturnType<typeof loadStaffPermissions>>;

export function StaffAdminManager({ token }: { token: string }) {
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

  return (
    <>
      <section className="panel">
        <span className="badge">M20-C · staff.read + GLOBAL</span>
        <h2>Staff / RBAC / Data Scope</h2>
        <p>
          当前批次先接入服务端 Staff、角色、权限与 Data Scope 只读上下文；密码哈希不会返回到前端。
          账号创建、启停、密码重置和角色/Scope 写操作将在 M20-C 下一批接入。
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
