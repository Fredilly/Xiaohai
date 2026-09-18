import { useEffect, useState, type FormEvent } from 'react';
import {
  changeCommissionRuleStatus,
  createCommissionRule,
  getCommissionOverview,
  reviewWithdrawal,
  settleCommission,
  type CommissionOverview,
} from './commission-api';

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
      .catch(() => setMessage('加载失败：需要佣金权限与 GLOBAL Data Scope。'));
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
      <p className="muted">比例、冻结期由已审核规则明确配置；前端金额不作为账务依据。</p>
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
      {data.rules.map((rule) => (
        <div className="context" key={rule.id}>
          <strong>{rule.name}</strong>
          <span>
            {rule.status} · {rule.rateBasisPoints} bp · 冻结 {rule.freezeDays} 天
          </span>
          <button
            onClick={() =>
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
        </div>
      ))}
      <h3>提现审核</h3>
      {data.withdrawals.map((item) => (
        <div className="context" key={item.id}>
          <strong>¥{(item.amountMinor / 100).toFixed(2)}</strong>
          <span>
            {item.status} · {item.consumerUserId}
          </span>
          {item.status === 'REQUESTED' && (
            <>
              <button
                onClick={() =>
                  void reviewWithdrawal(token, item.id, 'APPROVE', item.version).then(load)
                }
              >
                批准
              </button>
              <button
                onClick={() =>
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
          <strong>¥{(item.amountMinor / 100).toFixed(2)}</strong>
          <span>
            {item.state} · 冻结至 {new Date(item.frozenUntil).toLocaleString()}
          </span>
          {item.state === 'FROZEN' && new Date(item.frozenUntil) <= new Date() && (
            <button onClick={() => void settleCommission(token, item.id).then(load)}>结算</button>
          )}
        </div>
      ))}
    </section>
  );
}
