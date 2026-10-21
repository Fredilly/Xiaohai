import { useEffect, useState, type FormEvent } from 'react';
import {
  getMeipingReviewPage,
  listMeipingReviewSessions,
  saveMeipingCorrectionReview,
  saveMeipingReviewCorrection,
  saveMeipingReviewDecision,
  type ReviewCorrection,
  type CorrectionReviewInput,
  type ReviewCorrectionInput,
  type ReviewDecisionInput,
  type ReviewItem,
  type ReviewPage,
  type ReviewSessionSummary,
} from './meiping-review-api';
import {
  correctionProposalInput,
  correctionVerdictInput,
  reviewApiErrorMessage,
  reviewDecisionInput,
} from './meiping-review-input';
import {
  meipingDispositionLabel,
  meipingIssueLabel,
  meipingSessionStatusLabel,
} from './meiping-review-display';

const PAGE_SIZE = 20;
type Props = { token: string; storeId: string; permissions: readonly string[] };
type CorrectionFields = {
  title: string;
  author: string;
  publisher: string;
  barcode: string;
  priceYuan: string;
};

export function meipingStorePermissions(permissions: readonly string[]) {
  const canEdit =
    permissions.includes('inventory.receive') && permissions.includes('inventory.stocktake');
  const canReview = permissions.includes('meiping.correction.review');
  return { canRead: canEdit || canReview, canEdit, canReview };
}

export function MeipingReviewPanel({ token, storeId, permissions }: Props) {
  const { canRead, canEdit, canReview } = meipingStorePermissions(permissions);
  const [sessions, setSessions] = useState<ReviewSessionSummary[]>([]);
  const [selected, setSelected] = useState<ReviewSessionSummary | null>(null);
  const [sessionOffset, setSessionOffset] = useState(0);
  const [rowOffset, setRowOffset] = useState(0);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [page, setPage] = useState<ReviewPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setSelected(null);
    setPage(null);
    setRowOffset(0);
    setSessionOffset(0);
    setStatus('');
  }, [storeId, token]);

  useEffect(() => {
    if (!canRead || !storeId || selected) return;
    let alive = true;
    setBusy(true);
    void listMeipingReviewSessions(token, storeId, sessionOffset, PAGE_SIZE)
      .then((result) => {
        if (!alive) return;
        setSessions(result.items);
        setHasMoreSessions(result.hasMore);
      })
      .catch((error: unknown) => {
        if (alive) setStatus(reviewApiErrorMessage(error));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [canRead, selected, sessionOffset, storeId, token, retry]);

  useEffect(() => {
    if (!selected || !canRead || !storeId) return;
    let alive = true;
    setBusy(true);
    void getMeipingReviewPage(token, storeId, selected.id, rowOffset, PAGE_SIZE)
      .then((result) => {
        if (alive) setPage(result);
      })
      .catch((error: unknown) => {
        if (alive) {
          setPage(null);
          setStatus(reviewApiErrorMessage(error));
        }
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [canRead, selected, rowOffset, storeId, token, retry]);

  async function mutate(operation: () => Promise<unknown>, success: string) {
    if (!selected || !page || busy || !canRead) return;
    setBusy(true);
    setStatus('');
    try {
      await operation();
      const next = await getMeipingReviewPage(token, storeId, selected.id, rowOffset, PAGE_SIZE);
      if (next.sourceChecksum !== page.sourceChecksum || next.sessionId !== selected.id) {
        throw new Error('REVIEW_PAGE_CONTEXT_MISMATCH');
      }
      setPage(next);
      setStatus(success + '。仅保存审核草稿，不会建立正式商品或更新库存。');
    } catch (error) {
      setStatus(reviewApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (!canRead) {
    return (
      <section className="panel">
        <h2>美萍迁移资料审核</h2>
        <p>当前账号没有审核草稿读取权限。</p>
      </section>
    );
  }

  return (
    <section className="panel meiping-store-panel">
      <span className="tag">历史数据 · 一次性迁移</span>
      <h2>美萍商品资料审核与纠错</h2>
      <p>
        门店工作人员在这里处理自己授权门店的历史迁移草稿。日常在售商品资料维护不在此模块，正式入库尚未开放。
      </p>
      <p>
        当前权限：{canEdit ? '可提交审核决定与纠错建议' : '仅可阅读草稿'}；
        {canReview ? '可独立复核他人的纠错建议' : '无独立复核权限'}。
      </p>
      {status && (
        <p className="store-status" role="status">
          {status}
        </p>
      )}
      {!selected ? (
        <>
          <h3>已有待处理审核草稿</h3>
          {busy && <p>正在读取草稿…</p>}
          {!busy && !sessions.length && <p>当前门店暂无待审核迁移草稿。不会自动创建商品或库存。</p>}
          <div className="meiping-store-list">
            {sessions.map((item) => (
              <div className="meiping-store-entry" key={item.id}>
                <div>
                  <strong>{item.totalRows} 条来源商品</strong>
                  <small>
                    已保存审核决定 {item.savedDecisions} 条 ·{' '}
                    {meipingSessionStatusLabel(item.status)}
                  </small>
                </div>
                <button
                  disabled={busy}
                  onClick={() => {
                    setRowOffset(0);
                    setPage(null);
                    setSelected(item);
                    setStatus('');
                  }}
                >
                  打开门店审核
                </button>
              </div>
            ))}
          </div>
          <div className="meiping-store-actions">
            <button
              disabled={busy || sessionOffset === 0}
              onClick={() => setSessionOffset((n) => Math.max(0, n - PAGE_SIZE))}
            >
              上一页
            </button>
            <button
              disabled={busy || !hasMoreSessions}
              onClick={() => setSessionOffset((n) => n + PAGE_SIZE)}
            >
              下一页
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="meiping-store-actions">
            <button
              disabled={busy}
              onClick={() => {
                setSelected(null);
                setPage(null);
                setStatus('');
                setRetry((n) => n + 1);
              }}
            >
              返回草稿列表
            </button>
            <button disabled={busy} onClick={() => setRetry((n) => n + 1)}>
              刷新当前草稿
            </button>
            <span>
              {selected.totalRows} 条来源记录 · {meipingSessionStatusLabel(selected.status)}
            </span>
          </div>
          {busy && !page && <p>正在读取审核明细…</p>}
          {page && (
            <>
              {page.items.map((item) => (
                <article className="meiping-store-row" key={item.sourceRowNumber}>
                  <div>
                    <h3>
                      源行 {item.sourceRowNumber} · {item.normalized.title ?? '未填写书名'}
                    </h3>
                    <p>
                      状态：{meipingDispositionLabel(item.disposition)} ·{' '}
                      {item.saleBlocked ? '禁止销售' : '仅供审核'} · 原条码：
                      {item.sourceIdentifiers.barcode || '无'}
                    </p>
                    <p>
                      原审核决定：
                      {item.decision
                        ? (item.decision.action === 'EXCLUDE' ? '不纳入此次迁移' : '创建草稿候选') +
                          ' · 版本 ' +
                          item.decision.version
                        : '尚未决定'}
                    </p>
                    {item.issueCodes.length > 0 && (
                      <p>
                        原始问题：
                        {item.issueCodes.map((code, index) => (
                          <span key={code + ':' + index} title={'内部代码：' + code}>
                            {index > 0 ? '、' : ''}
                            {meipingIssueLabel(code)}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                  {canEdit && (
                    <>
                      <StoreDecisionEditor
                        key={
                          'decision:' + item.sourceRowNumber + ':' + (item.decision?.version ?? 0)
                        }
                        item={item}
                        disabled={busy}
                        checksum={page.sourceChecksum}
                        onSubmit={(input) =>
                          mutate(
                            () => saveMeipingReviewDecision(token, storeId, selected.id, input),
                            '源行 ' + item.sourceRowNumber + ' 审核决定已更新',
                          )
                        }
                      />
                      <StoreCorrectionEditor
                        key={
                          'correction:' +
                          item.sourceRowNumber +
                          ':' +
                          (item.correction?.version ?? 0)
                        }
                        item={item}
                        disabled={busy}
                        checksum={page.sourceChecksum}
                        onSubmit={(input) =>
                          mutate(
                            () =>
                              saveMeipingReviewCorrection(
                                token,
                                storeId,
                                selected.id,
                                item.sourceRowNumber,
                                input,
                              ),
                            '源行 ' + item.sourceRowNumber + ' 纠错建议已保存，待独立复核',
                          )
                        }
                      />
                    </>
                  )}
                  {item.correction && (
                    <StoreIndependentReview
                      key={'review:' + item.sourceRowNumber + ':' + item.correction.version}
                      item={item}
                      disabled={busy}
                      enabled={canReview}
                      checksum={page.sourceChecksum}
                      onSubmit={(input) =>
                        mutate(
                          () =>
                            saveMeipingCorrectionReview(
                              token,
                              storeId,
                              selected.id,
                              item.sourceRowNumber,
                              input,
                            ),
                          '源行 ' + item.sourceRowNumber + ' 独立复核已记录',
                        )
                      }
                    />
                  )}
                </article>
              ))}
              <div className="meiping-store-actions">
                <button
                  disabled={busy || rowOffset === 0}
                  onClick={() => {
                    setPage(null);
                    setRowOffset((n) => Math.max(0, n - PAGE_SIZE));
                  }}
                >
                  上一页
                </button>
                <span>
                  {rowOffset + 1}–{Math.min(rowOffset + PAGE_SIZE, page.totalRows)} /{' '}
                  {page.totalRows}
                </span>
                <button
                  disabled={busy || rowOffset + PAGE_SIZE >= page.totalRows}
                  onClick={() => {
                    setPage(null);
                    setRowOffset((n) => n + PAGE_SIZE);
                  }}
                >
                  下一页
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function StoreDecisionEditor({
  item,
  checksum,
  disabled,
  onSubmit,
}: {
  item: ReviewItem;
  checksum: string;
  disabled: boolean;
  onSubmit: (input: ReviewDecisionInput) => Promise<void>;
}) {
  const [action, setAction] = useState<'' | 'CREATE_DRAFT' | 'EXCLUDE'>('');
  const [quantity, setQuantity] = useState(item.decision?.countedQuantity?.toString() ?? '');
  const [reason, setReason] = useState(item.decision?.reason ?? '');
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) {
      setError('请主动选择处理方式。');
      return;
    }
    const input = reviewDecisionInput(item, action, quantity, reason, checksum);
    if (typeof input === 'string') {
      setError(input);
      return;
    }
    setError('');
    void onSubmit(input);
  }
  return (
    <details className="meiping-store-editor">
      <summary>处理原审核决定</summary>
      <form onSubmit={submit}>
        <label>
          处理方式
          <select
            disabled={disabled}
            value={action}
            onChange={(event) => setAction(event.target.value as typeof action)}
          >
            <option value="">请选择</option>
            <option value="EXCLUDE">不纳入此次迁移</option>
            {item.disposition === 'CREATE_CANDIDATE' && (
              <option value="CREATE_DRAFT">创建草稿候选（不入库）</option>
            )}
          </select>
        </label>
        {action === 'CREATE_DRAFT' ? (
          <label>
            实盘数量
            <input
              disabled={disabled}
              type="number"
              min={0}
              step={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>
        ) : (
          <label>
            排除原因
            <textarea
              disabled={disabled}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        <button disabled={disabled || !action}>保存原审核决定</button>
      </form>
    </details>
  );
}

function StoreCorrectionEditor({
  item,
  checksum,
  disabled,
  onSubmit,
}: {
  item: ReviewItem;
  checksum: string;
  disabled: boolean;
  onSubmit: (input: ReviewCorrectionInput) => Promise<void>;
}) {
  const saved = item.correction?.proposedFields;
  const [values, setValues] = useState<CorrectionFields>({
    title: saved?.title ?? '',
    author: saved?.author ?? '',
    publisher: saved?.publisher ?? '',
    barcode: saved?.barcode ?? '',
    priceYuan: saved?.priceMinor === undefined ? '' : (saved.priceMinor / 100).toFixed(2),
  });
  const [reason, setReason] = useState(item.correction?.reason ?? '');
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = correctionProposalInput(item, values, reason, checksum);
    if (typeof input === 'string') {
      setError(input);
      return;
    }
    setError('');
    void onSubmit(input);
  }
  return (
    <details className="meiping-store-editor">
      <summary>
        {item.correction ? '查看 / 修改纠错建议 · 版本 ' + item.correction.version : '提出纠错建议'}
      </summary>
      <form onSubmit={submit}>
        <p>只填写需要调整的字段；本操作不会覆盖 Excel 原始行或正式商品。</p>
        {(
          [
            ['title', '建议书名'],
            ['author', '建议作者'],
            ['publisher', '建议出版社'],
            ['barcode', '建议条码'],
            ['priceYuan', '建议定价（元）'],
          ] as const
        ).map(([name, label]) => (
          <label key={name}>
            {label}
            <input
              disabled={disabled}
              value={values[name]}
              onChange={(event) => setValues((prev) => ({ ...prev, [name]: event.target.value }))}
            />
          </label>
        ))}
        <label>
          纠错原因
          <textarea
            disabled={disabled}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button disabled={disabled}>保存纠错建议（待复核）</button>
      </form>
    </details>
  );
}

function displayPrice(priceMinor: number | null) {
  return priceMinor === null ? '未填写' : '¥' + (priceMinor / 100).toFixed(2);
}
function proposedDisplay(item: ReviewItem) {
  const fields: ReviewCorrection['proposedFields'] = item.correction?.proposedFields ?? {};
  return [
    { name: '书名', original: item.normalized.title ?? '未填写', value: fields.title },
    { name: '作者', original: item.normalized.author ?? '未填写', value: fields.author },
    { name: '出版社', original: item.normalized.publisher ?? '未填写', value: fields.publisher },
    { name: '条码', original: item.sourceIdentifiers.barcode ?? '未填写', value: fields.barcode },
    {
      name: '定价',
      original: displayPrice(item.normalized.priceMinor),
      value: fields.priceMinor === undefined ? undefined : displayPrice(fields.priceMinor),
    },
  ].filter((value) => value.value !== undefined);
}

export function StoreIndependentReview({
  item,
  checksum,
  disabled,
  enabled,
  onSubmit,
}: {
  item: ReviewItem;
  checksum: string;
  disabled: boolean;
  enabled: boolean;
  onSubmit: (input: CorrectionReviewInput) => Promise<void>;
}) {
  const [verdict, setVerdict] = useState<'' | 'ACCEPTED' | 'REJECTED'>('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  if (!item.correction) return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item.correction) return;
    const input = correctionVerdictInput(checksum, item.correction.version, verdict, reason);
    if (typeof input === 'string') {
      setError(input);
      return;
    }
    const label = input.verdict === 'ACCEPTED' ? '采纳建议（不入库）' : '驳回建议';
    if (
      !window.confirm(
        '确定要' +
          label +
          '？源行 ' +
          item.sourceRowNumber +
          ' · 版本 ' +
          item.correction.version +
          '。该复核结果不可撤销。',
      )
    )
      return;
    setError('');
    void onSubmit(input);
  }

  return (
    <section className="meiping-store-review">
      <h4>纠错建议独立复核 · 版本 {item.correction.version}</h4>
      <p>纠错建议的采纳不代表实物已核验、条码冲突已经解决或商品可以入库。</p>
      <dl>
        {proposedDisplay(item).map((entry) => (
          <div key={entry.name}>
            <dt>{entry.name}</dt>
            <dd>
              原始：{entry.original} → 建议：{entry.value}
            </dd>
          </div>
        ))}
      </dl>
      <p>建议提交原因：{item.correction.reason}</p>
      {item.correctionReview ? (
        <p className="store-status">
          当前版本已
          {item.correctionReview.verdict === 'ACCEPTED' ? '采纳建议（不入库）' : '驳回建议'} ·
          复核原因：{item.correctionReview.reason}
        </p>
      ) : enabled ? (
        <form onSubmit={submit}>
          <label>
            复核结果（必须主动选择）
            <select
              disabled={disabled}
              value={verdict}
              onChange={(event) => setVerdict(event.target.value as typeof verdict)}
            >
              <option value="">请选择，不默认采纳或驳回</option>
              <option value="REJECTED">驳回建议</option>
              <option value="ACCEPTED">采纳建议（不入库）</option>
            </select>
          </label>
          <label>
            独立复核原因
            <textarea
              disabled={disabled}
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button disabled={disabled || !verdict}>确认并提交不可撤销的复核结果</button>
        </form>
      ) : (
        <p>当前账号没有独立复核权限，建议内容仅供查看。</p>
      )}
    </section>
  );
}
