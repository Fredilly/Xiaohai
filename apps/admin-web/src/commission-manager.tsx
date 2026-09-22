import { useEffect, useState, type FormEvent } from 'react';
import {
  changeCommissionRuleStatus,
  createCommissionRule,
  getCommissionOverview,
  reviewWithdrawal,
  settleCommission,
  type CommissionOverview,
} from './commission-api';
import { displayStatus, money } from './display';

export function CommissionManager({ token }: { token: string }) {
  const [data, setData] = useState<CommissionOverview>({
    rules: [],
    earnings: [],
    withdrawals: [],
  });
  const [message, setMessage] = useState('加载中…');
  const load = () =>
    getCommissionOverview(token)
      .then((value) => {
        setData(value);
        setMessage('');
      })
      .catch(() => setMessage('加载失败，请检查权限或稍后重试。'));
  useEffect(() => {
    void load();
  }, [token]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = form.get('name');
    const effectiveFrom = form.get('effectiveFrom');
    if (typeof name !== 'string' || typeof effectiveFrom !== 'string') return;
    try {
      await createCommissionRule(token, {
        name,
        rateBasisPoints: Number(form.get('rateBasisPoints')),
        freezeDays: Number(form.get('freezeDays')),
        effectiveFrom: new Date(effectiveFrom).toISOString(),
      });
      event.currentTarget.reset();
      await load();
    } catch {
      setMessage('规则创建失败，请检查字段和权限。');
    }
  }
  return (
    <section className="panel">
      <h2>佣金与提现</h2>
      <p className="muted">查看佣金规则、待审核提现与冻结记录。</p>
      <p>{message}</p>
      <form onSubmit={(e) => void submit(e)}>
        <label>
          规则名称
          <input name="name" required />
        </label>
        <label>
          比例（基点）
          <input name="rateBasisPoints" type="number" min="0" max="10000" required />
        </label>
        <label>
          冻结天数
          <input name="freezeDays" type="number" min="0" max="365" required />
        </label>
        <label>
          生效时间
          <input name="effectiveFrom" type="datetime-local" required />
        </label>
        <button>创建草稿</button>
      </form>
      <h3>规则</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>状态</th>
              <th>比例</th>
              <th>冻结期</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.rules.map((rule) => (
              <tr key={rule.id}>
                <td>
                  <strong>{rule.name}</strong>
                </td>
                <td>{displayStatus(rule.status)}</td>
                <td>{(rule.rateBasisPoints / 100).toFixed(2)}%</td>
                <td>{rule.freezeDays} 天</td>
                <td>
                  <button
                    onClick={() =>
                      window.confirm(
                        `确定${rule.status === 'ACTIVE' ? '停用' : '启用'}佣金规则？`,
                      ) &&
                      void changeCommissionRuleStatus(
                        token,
                        rule.id,
                        rule.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                        rule.version,
                      ).then(load)
                    }
                  >
                    {rule.status === 'ACTIVE' ? '停用' : '启用'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.rules.length && <p>暂无佣金规则。</p>}
      <h3>提现审核</h3>
      {data.withdrawals.map((item) => (
        <div className="context" key={item.id}>
          <strong>{money(item.amountMinor)}</strong>
          <span>{displayStatus(item.status)}</span>
          <details>
            <summary>申请人编号</summary>
            <code>{item.consumerUserId}</code>
          </details>
          {item.status === 'REQUESTED' && (
            <>
              <button
                onClick={() =>
                  window.confirm('确认批准提现申请？') &&
                  void reviewWithdrawal(token, item.id, 'APPROVE', item.version).then(load)
                }
              >
                批准
              </button>
              <button
                onClick={() =>
                  window.confirm('确认拒绝提现申请并释放金额？') &&
                  void reviewWithdrawal(token, item.id, 'REJECT', item.version).then(load)
                }
              >
                拒绝并释放
              </button>
            </>
          )}
          {item.status === 'APPROVED' && (
            <button
              onClick={() =>
                window.confirm('仅在实际完成打款后确认：标记为已打款？') &&
                void reviewWithdrawal(token, item.id, 'MARK_PAID', item.version).then(load)
              }
            >
              标记已打款
            </button>
          )}
        </div>
      ))}
      <h3>冻结佣金</h3>
      {data.earnings.map((item) => (
        <div className="context" key={item.id}>
          <strong>{money(item.amountMinor)}</strong>
          <span>
            {displayStatus(item.state)} · 冻结至 {new Date(item.frozenUntil).toLocaleString()}
          </span>
          {item.state === 'FROZEN' && new Date(item.frozenUntil) <= new Date() && (
            <button
              onClick={() =>
                window.confirm('确认结算这笔佣金？') &&
                void settleCommission(token, item.id).then(load)
              }
            >
              结算
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
