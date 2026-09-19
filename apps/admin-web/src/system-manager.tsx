import { useEffect, useState, type FormEvent } from 'react';
import type { StaffMeResponse } from '@xiaohai/contracts';
import type { AuditLog } from '@xiaohai/contracts/audit';
import type { ModulePreview } from './mock-data';
import { loadAuditLogs, loadSystemHealth } from './system-api';

type Props = {
  token: string;
  me: StaffMeResponse;
  modules: ModulePreview[];
};

function timestamp(value: string) {
  return new Date(value).toLocaleString();
}

function Metadata({ value }: { value: Record<string, unknown> }) {
  const text = JSON.stringify(value);
  return <code>{text === '{}' ? '—' : text}</code>;
}

export function SystemManager({ token, me, modules }: Props) {
  const [health, setHealth] = useState<'loading' | 'ok' | 'error'>('loading');
  const [healthService, setHealthService] = useState('—');
  const [auditRows, setAuditRows] = useState<AuditLog[]>([]);
  const [auditStatus, setAuditStatus] = useState('等待加载');
  const canReadAudit = me.permissions.includes('audit.read');

  useEffect(() => {
    void loadSystemHealth()
      .then((result) => {
        setHealth(result.status);
        setHealthService(result.service);
      })
      .catch(() => {
        setHealth('error');
        setHealthService('不可用');
      });

    if (canReadAudit) {
      setAuditStatus('加载中…');
      void loadAuditLogs(token, { limit: 50 })
        .then((result) => {
          setAuditRows(result.items);
          setAuditStatus(`已加载 ${result.items.length} 条`);
        })
        .catch((error: unknown) => {
          setAuditStatus(error instanceof Error ? `加载失败：${error.message}` : '加载失败');
        });
    }
  }, [canReadAudit, token]);

  async function submitAuditFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canReadAudit) return;
    const data = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    };

    setAuditStatus('查询中…');
    try {
      const result = await loadAuditLogs(token, {
        actorStaffAccountId: text('actorStaffAccountId'),
        actionKey: text('actionKey'),
        resourceType: text('resourceType'),
        resourceId: text('resourceId'),
        requestId: text('requestId'),
        limit: 100,
      });
      setAuditRows(result.items);
      setAuditStatus(`已加载 ${result.items.length} 条`);
    } catch (error) {
      setAuditStatus(error instanceof Error ? `查询失败：${error.message}` : '查询失败');
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <span className="eyebrow">SYSTEM STATUS</span>
        <h2>系统状态</h2>
        <div className="compact-row">
          <span>API Health</span>
          <strong>{health === 'loading' ? '检测中…' : health === 'ok' ? '正常' : '异常'}</strong>
        </div>
        <div className="compact-row">
          <span>Service</span>
          <strong>{healthService}</strong>
        </div>
        <div className="compact-row">
          <span>当前 Staff</span>
          <strong>{me.staff.loginIdentifier}</strong>
        </div>
        <div className="compact-row">
          <span>Permissions</span>
          <strong>{me.permissions.length}</strong>
        </div>
        <div className="compact-row">
          <span>Data Scopes</span>
          <strong>{me.dataScopes.length}</strong>
        </div>
        <div className="compact-row">
          <span>当前可见模块</span>
          <strong>{modules.length}</strong>
        </div>
        <p className="muted">
          M20 不提供任意 key/value 配置写入。系统配置继续由各领域模块或部署环境持有，避免创建绕过领域校验的通用配置入口。
        </p>
      </section>

      <section className="panel">
        <span className="eyebrow">OPERATIONAL AUDIT</span>
        <h2>操作审计</h2>
        {!canReadAudit ? (
          <div className="empty-state">
            <strong>缺少 audit.read 权限</strong>
            <span>审计读取需要显式权限与 GLOBAL Data Scope，前端不会替代服务端授权。</span>
          </div>
        ) : (
          <>
            <form className="filter-grid" onSubmit={(event) => void submitAuditFilter(event)}>
              <label>
                Actor Staff ID
                <input name="actorStaffAccountId" placeholder="UUID" />
              </label>
              <label>
                Action
                <input name="actionKey" placeholder="staff.account.enabled" />
              </label>
              <label>
                Resource Type
                <input name="resourceType" placeholder="staff_account" />
              </label>
              <label>
                Resource ID
                <input name="resourceId" />
              </label>
              <label>
                Request ID
                <input name="requestId" />
              </label>
              <button type="submit">查询审计</button>
            </form>
            <p className="muted">{auditStatus}</p>
            {auditRows.length === 0 ? (
              <div className="empty-state">
                <strong>暂无审计记录</strong>
                <span>Staff / RBAC / Data Scope 的 M20 写操作会进入 append-only audit log。</span>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>Actor</th>
                      <th>Action</th>
                      <th>Resource</th>
                      <th>Request</th>
                      <th>Metadata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditRows.map((row) => (
                      <tr key={row.id}>
                        <td>{timestamp(row.createdAt)}</td>
                        <td>{row.actorStaffAccountId}</td>
                        <td>{row.actionKey}</td>
                        <td>
                          {row.resourceType}
                          {row.resourceId ? ` · ${row.resourceId}` : ''}
                        </td>
                        <td>{row.requestId}</td>
                        <td>
                          <Metadata value={row.metadata} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
