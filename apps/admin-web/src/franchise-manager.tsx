import { useEffect, useState, type FormEvent } from 'react';
import type {
  FranchiseApplicationBase,
  FranchiseApplicationStatus,
  FranchiseApplicationView,
  FranchiseFollowupChannel,
} from '@xiaohai/contracts/franchise';
import {
  addFranchiseFollowup,
  assignFranchiseApplication,
  getFranchiseApplication,
  listFranchiseApplications,
  reviewFranchiseApplication,
  updateFranchiseApplicationStatus,
} from './franchise-api';
import './franchise.css';

const statuses: FranchiseApplicationStatus[] = [
  'SUBMITTED',
  'ASSIGNED',
  'FOLLOWING_UP',
  'APPROVED',
  'REJECTED',
  'SIGNED',
  'PREPARING',
  'OPENED',
  'CLOSED',
];
const channels: FranchiseFollowupChannel[] = ['PHONE', 'WECHAT', 'EMAIL', 'MEETING', 'OTHER'];

function formText(data: FormData, field: string) {
  const value = data.get(field);
  return typeof value === 'string' ? value.trim() : '';
}

export function FranchiseManager({ token, staffId }: { token: string; staffId: string }) {
  const [rows, setRows] = useState<FranchiseApplicationBase[]>([]);
  const [selected, setSelected] = useState<FranchiseApplicationView | null>(null);
  const [status, setStatus] = useState<FranchiseApplicationStatus | ''>('');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const result = await listFranchiseApplications(token, {
      ...(status ? { status } : {}),
      ...(query.trim() ? { query: query.trim() } : {}),
      limit: 100,
    });
    setRows(result.items);
  }

  useEffect(() => {
    void load().catch(() => setMessage('无法读取加盟线索，需要 franchise.read 与 GLOBAL scope。'));
  }, [token]);

  async function open(id: string) {
    setBusy(true);
    setMessage('');
    try {
      setSelected(await getFranchiseApplication(token, id));
    } catch {
      setMessage('加盟申请详情读取失败，请检查权限或刷新列表。');
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<FranchiseApplicationView>, success: string) {
    if (!selected || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await action();
      setSelected(result);
      setMessage(success);
      await load();
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      setMessage(
        code === 'STALE_VERSION'
          ? '数据已被其他人更新，请重新打开申请后再操作。'
          : code === 'INVALID_STATE'
            ? '当前状态不允许执行该操作。'
            : code === 'STAFF_FORBIDDEN'
              ? '当前账号没有所需权限或 GLOBAL scope。'
              : '操作失败，请检查输入和当前状态。',
      );
    } finally {
      setBusy(false);
    }
  }

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const assignee = formText(data, 'assignee');
    if (!assignee) return;
    await run(
      () =>
        assignFranchiseApplication(token, selected.id, {
          staffAccountId: assignee,
          version: selected.version,
        }),
      '负责人已更新。',
    );
  }

  async function followup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const channel = (formText(data, 'channel') || 'PHONE') as FranchiseFollowupChannel;
    const note = formText(data, 'note');
    const nextFollowupAt = formText(data, 'nextFollowupAt');
    if (!note) return;
    await run(
      () =>
        addFranchiseFollowup(token, selected.id, {
          channel,
          note,
          ...(nextFollowupAt ? { nextFollowupAt: new Date(nextFollowupAt).toISOString() } : {}),
          version: selected.version,
        }),
      '跟进记录已追加。',
    );
    event.currentTarget.reset();
  }

  async function review(decision: 'APPROVED' | 'REJECTED') {
    if (!selected) return;
    const note =
      window.prompt(decision === 'APPROVED' ? '审核备注（可选）' : '请填写拒绝原因（可选）') ?? '';
    await run(
      () =>
        reviewFranchiseApplication(token, selected.id, {
          decision,
          ...(note.trim() ? { note: note.trim() } : {}),
          version: selected.version,
        }),
      decision === 'APPROVED' ? '申请已审核通过。' : '申请已拒绝。',
    );
  }

  async function advance(status: 'SIGNED' | 'PREPARING' | 'OPENED' | 'CLOSED') {
    if (!selected) return;
    await run(
      () => updateFranchiseApplicationStatus(token, selected.id, status, selected.version),
      `状态已更新为 ${status}。`,
    );
  }

  return (
    <section className="panel franchise-manager">
      <div className="franchise-toolbar">
        <div>
          <h2>加盟线索管理</h2>
          <p>服务端执行 Staff RBAC、GLOBAL Data Scope、状态机与版本检查。</p>
        </div>
        <button disabled={busy} onClick={() => void load().catch(() => setMessage('刷新失败'))}>
          刷新
        </button>
      </div>

      <div className="franchise-filters">
        <input
          value={query}
          placeholder="申请编号 / 姓名 / 电话 / 邮箱"
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as FranchiseApplicationStatus | '')}
        >
          <option value="">全部状态</option>
          {statuses.map((item) => (
            <option value={item} key={item}>
              {item}
            </option>
          ))}
        </select>
        <button disabled={busy} onClick={() => void load().catch(() => setMessage('筛选失败'))}>
          查询
        </button>
      </div>

      <p role="status">{message}</p>

      <div className="franchise-layout">
        <div className="franchise-list">
          {rows.length === 0 ? <p>暂无符合条件的加盟申请。</p> : null}
          {rows.map((row) => (
            <button
              type="button"
              className={selected?.id === row.id ? 'franchise-row active' : 'franchise-row'}
              key={row.id}
              onClick={() => void open(row.id)}
            >
              <strong>{row.name}</strong>
              <span>{row.applicationNumber}</span>
              <span>
                {row.region} · {row.city}
              </span>
              <em>{row.status}</em>
            </button>
          ))}
        </div>

        <div className="franchise-detail">
          {!selected ? (
            <div className="empty-state">
              <strong>选择一条加盟申请</strong>
              <span>查看详情后可分配、跟进、审核和推进状态。</span>
            </div>
          ) : (
            <>
              <div className="franchise-detail-head">
                <div>
                  <span className="badge">{selected.status}</span>
                  <h3>{selected.name}</h3>
                  <p>{selected.applicationNumber}</p>
                </div>
                <small>v{selected.version}</small>
              </div>

              <div className="franchise-meta">
                <span>电话：{selected.phone}</span>
                <span>邮箱：{selected.email || '未填写'}</span>
                <span>
                  地区：{selected.country} / {selected.region} / {selected.city}
                  {selected.district ? ` / ${selected.district}` : ''}
                </span>
                <span>负责人：{selected.assignedStaffAccountId || '未分配'}</span>
                <span>提交时间：{selected.submittedAt.toLocaleString()}</span>
              </div>

              {selected.background ? <p>背景：{selected.background}</p> : null}
              {selected.message ? <p>补充说明：{selected.message}</p> : null}
              {selected.reviewNote ? <p>审核备注：{selected.reviewNote}</p> : null}

              <div className="franchise-actions">
                <form onSubmit={(event) => void assign(event)}>
                  <input
                    name="assignee"
                    defaultValue={selected.assignedStaffAccountId ?? staffId}
                    required
                  />
                  <button disabled={busy}>分配负责人</button>
                </form>

                <form onSubmit={(event) => void followup(event)}>
                  <select name="channel" defaultValue="PHONE">
                    {channels.map((channel) => (
                      <option value={channel} key={channel}>
                        {channel}
                      </option>
                    ))}
                  </select>
                  <input name="note" placeholder="跟进记录" required />
                  <input name="nextFollowupAt" type="datetime-local" />
                  <button disabled={busy}>追加跟进</button>
                </form>

                <div className="action-buttons">
                  <button disabled={busy} onClick={() => void review('APPROVED')}>
                    审核通过
                  </button>
                  <button disabled={busy} onClick={() => void review('REJECTED')}>
                    拒绝
                  </button>
                  {nextStatus(selected.status) ? (
                    <button
                      disabled={busy}
                      onClick={() => void advance(nextStatus(selected.status)!)}
                    >
                      推进到 {nextStatus(selected.status)}
                    </button>
                  ) : null}
                  {selected.status !== 'CLOSED' && selected.status !== 'REJECTED' ? (
                    <button disabled={busy} onClick={() => void advance('CLOSED')}>
                      关闭线索
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="followup-timeline">
                <h3>跟进记录</h3>
                {selected.followups.length === 0 ? <p>暂无跟进记录。</p> : null}
                {selected.followups.map((item) => (
                  <article key={item.id}>
                    <strong>{item.channel}</strong>
                    <span>{item.note}</span>
                    <small>{item.createdAt.toLocaleString()}</small>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function nextStatus(current: FranchiseApplicationStatus): 'SIGNED' | 'PREPARING' | 'OPENED' | null {
  if (current === 'APPROVED') return 'SIGNED';
  if (current === 'SIGNED') return 'PREPARING';
  if (current === 'PREPARING') return 'OPENED';
  return null;
}
