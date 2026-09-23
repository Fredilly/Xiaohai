import { useEffect, useState, type FormEvent } from 'react';
import type {
  FinanceEventType,
  FinanceLedgerEntry,
  FinanceReconciliationRun,
  FinanceSourceKind,
  FinanceSummaryResponse,
} from '@xiaohai/contracts/finance';
import {
  createFinanceReconciliation,
  exportFinanceLedger,
  loadFinanceLedger,
  loadFinanceReconciliation,
  loadFinanceSummary,
} from './finance-api';

const eventTypes: FinanceEventType[] = [
  'PAYMENT',
  'REFUND',
  'COMMISSION_FROZEN',
  'COMMISSION_SETTLED',
  'COMMISSION_REVERSED',
  'WITHDRAWAL_HELD',
  'WITHDRAWAL_RELEASED',
  'WITHDRAWAL_PAID',
];

export function FinanceManager({
  token,
  canReconcile,
  canExport,
}: {
  token: string;
  canReconcile: boolean;
  canExport: boolean;
}) {
  const defaults = defaultRange();
  const [summary, setSummary] = useState<FinanceSummaryResponse | null>(null);
  const [entries, setEntries] = useState<FinanceLedgerEntry[]>([]);
  const [run, setRun] = useState<FinanceReconciliationRun | null>(null);
  const [status, setStatus] = useState('');
  const [range, setRange] = useState(defaults);
  const [sourceKind, setSourceKind] = useState<FinanceSourceKind | ''>('');
  const [eventType, setEventType] = useState<FinanceEventType | ''>('');

  const refresh = async (
    nextRange = range,
    nextSourceKind: FinanceSourceKind | '' = sourceKind,
    nextEventType: FinanceEventType | '' = eventType,
  ) => {
    try {
      setStatus('正在读取财务控制数据…');
      const [summaryResult, ledgerResult] = await Promise.all([
        loadFinanceSummary(token, nextRange),
        loadFinanceLedger(token, {
          ...nextRange,
          sourceKind: nextSourceKind || undefined,
          eventType: nextEventType || undefined,
          limit: 100,
        }),
      ]);
      setSummary(summaryResult);
      setEntries(ledgerResult.items);
      setStatus(`已加载 ${ledgerResult.items.length} 条统一财务流水`);
    } catch (error) {
      setStatus(error instanceof Error ? `加载失败：${error.message}` : '加载失败');
    }
  };

  useEffect(() => {
    void refresh(defaults, '', '');
  }, [token]);

  async function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextRange = readRange(form);
    const nextSourceKind = text(form, 'sourceKind') as FinanceSourceKind | '';
    const nextEventType = text(form, 'eventType') as FinanceEventType | '';
    setRange(nextRange);
    setSourceKind(nextSourceKind);
    setEventType(nextEventType);
    await refresh(nextRange, nextSourceKind, nextEventType);
  }

  async function reconcile() {
    if (!window.confirm('确认对当前时间范围运行内部对账？结果将留在对账记录中。')) return;
    try {
      setStatus('正在执行内部财务对账…');
      const next = await createFinanceReconciliation(token, range);
      setRun(next);
      setStatus(
        `对账完成：匹配 ${next.matchedCount}，缺失 ${next.missingCount}，金额不一致 ${next.mismatchCount}`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? `对账失败：${error.message}` : '对账失败');
    }
  }

  async function reloadRun() {
    if (!run) return;
    try {
      setRun(await loadFinanceReconciliation(token, run.id));
    } catch (error) {
      setStatus(error instanceof Error ? `对账详情加载失败：${error.message}` : '对账详情加载失败');
    }
  }

  async function exportCsv() {
    try {
      setStatus('正在生成受控财务导出…');
      const result = await exportFinanceLedger(token, {
        ...range,
        sourceKind: sourceKind || undefined,
        eventType: eventType || undefined,
        limit: 5_000,
      });
      const url = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus(`已导出 ${result.rowCount} 条财务流水；导出操作已写入审计日志`);
    } catch (error) {
      setStatus(error instanceof Error ? `导出失败：${error.message}` : '导出失败');
    }
  }

  return (
    <>
      <section className="panel">
        <span className="badge">财务工作区</span>
        <h2>财务控制</h2>
        <p>查看财务流水与对账结果。退款、佣金和提现仍在各自业务模块处理。</p>
        <form className="ops-form compact-form" onSubmit={(event) => void submitFilters(event)}>
          <label>
            开始时间
            <input
              name="from"
              type="datetime-local"
              defaultValue={toLocalInput(defaults.from)}
              required
            />
          </label>
          <label>
            结束时间
            <input
              name="to"
              type="datetime-local"
              defaultValue={toLocalInput(defaults.to)}
              required
            />
          </label>
          <select name="sourceKind" defaultValue="">
            <option value="">全部来源</option>
            <option value="PAYMENT_LEDGER">PAYMENT_LEDGER</option>
            <option value="COMMISSION_EVENT">COMMISSION_EVENT</option>
          </select>
          <select name="eventType" defaultValue="">
            <option value="">全部事件</option>
            {eventTypes.map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
          <button>筛选</button>
        </form>
        <div className="button-row">
          {canReconcile && <button onClick={() => void reconcile()}>运行内部对账</button>}
          {canExport && <button onClick={() => void exportCsv()}>导出 CSV</button>}
          <button onClick={() => void refresh()}>刷新</button>
        </div>
        <p>{status}</p>
      </section>

      <section className="panel">
        <h3>财务汇总</h3>
        {summary ? (
          <div className="module-grid">
            <Metric label="现金流入" value={money(summary.cashInflowMinor)} />
            <Metric label="现金流出" value={money(summary.cashOutflowMinor)} />
            <Metric label="现金净额" value={money(summary.netCashMinor)} />
            <Metric label="冻结佣金变动" value={money(summary.commissionFrozenDeltaMinor)} />
            <Metric label="可用佣金变动" value={money(summary.commissionAvailableDeltaMinor)} />
          </div>
        ) : (
          <p>暂无汇总。</p>
        )}
      </section>

      <section className="panel">
        <h3>统一财务流水</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>事件</th>
                <th>来源</th>
                <th>现金变动</th>
                <th>冻结佣金变动</th>
                <th>可用佣金变动</th>
                <th>技术详情</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.occurredAt).toLocaleString()}</td>
                  <td>{entry.eventType}</td>
                  <td>{entry.sourceKind}</td>
                  <td>{money(entry.cashDeltaMinor)}</td>
                  <td>{money(entry.commissionFrozenDeltaMinor)}</td>
                  <td>{money(entry.commissionAvailableDeltaMinor)}</td>
                  <td>
                    <details>
                      <summary>事件标识</summary>
                      <code>{entry.eventKey}</code>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!entries.length && <p>当前筛选条件下没有统一财务流水。</p>}
      </section>

      {run && (
        <section className="panel">
          <h3>最近内部对账</h3>
          <div className="context">
            <p>ID：{run.id}</p>
            <p>状态：{run.status}</p>
            <p>
              匹配：{run.matchedCount} · 缺失：{run.missingCount} · 不一致：{run.mismatchCount}
            </p>
            <p>
              范围：{new Date(run.rangeFrom).toLocaleString()} →{' '}
              {new Date(run.rangeTo).toLocaleString()}
            </p>
          </div>
          <button onClick={() => void reloadRun()}>刷新对账详情</button>
          <div className="module-grid">
            {run.items?.map((item) => (
              <div className="empty-state" key={item.id}>
                <strong>{item.outcome}</strong>
                <span>{item.eventType}</span>
                <span>{item.sourceKind}</span>
                <small>{item.eventKey}</small>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <h3>业务操作入口</h3>
        <div className="button-row">
          <a href="#/payments">支付 / 退款</a>
          <a href="#/commission">佣金 / 提现</a>
          <a href="#/system">系统 / 审计</a>
        </div>
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="empty-state">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function toLocalInput(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function readRange(data: FormData) {
  const from = text(data, 'from');
  const to = text(data, 'to');
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

function text(data: FormData, field: string) {
  const value = data.get(field);
  return typeof value === 'string' ? value.trim() : '';
}

function money(value: number) {
  const sign = value < 0 ? '-' : '';
  return `${sign}¥${(Math.abs(value) / 100).toFixed(2)}`;
}
