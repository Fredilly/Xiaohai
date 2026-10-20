import { useEffect, useMemo, useState } from 'react';
import {
  createMeipingReviewSession,
  getMeipingReviewPage,
  saveMeipingReviewDecision,
  saveMeipingReviewCorrection,
  type ReviewCorrectionInput,
  type ReviewDecisionInput,
  type ReviewItem,
  type ReviewPage,
  type ReviewSession,
} from './meiping-review-api';
import { reviewApiErrorMessage, reviewDecisionInput } from './meiping-review-form';
import { correctionProposalInput } from './meiping-review-correction-form';
import type { MeipingPreflightReport } from './meiping-preflight-api';

const PAGE_SIZE = 25;
type View = 'ALL' | 'UNDONE' | 'BLOCKED' | 'SAVED';

const issueLabels: Record<string, string> = {
  AUTHOR_MISSING: '缺少作者',
  PUBLISHER_MISSING: '缺少出版社',
  BARCODE_CONFLICT: '条码冲突',
  DUPLICATE_BARCODE: '条码重复',
  ZERO_PRICE: '零定价',
  BOOK_CODE_CONFLICT: '商品编号冲突',
  INTERNAL_CODE_CONFLICT: '自有编号冲突',
  NON_BOOK_CATEGORY: '非图书',
  FORMULA_ROW_REVIEW: '公式行需核对',
};
export function filterReviewPage(items: ReviewItem[], view: View): ReviewItem[] {
  if (view === 'UNDONE') return items.filter((item) => item.decision === null);
  if (view === 'BLOCKED') return items.filter((item) => item.disposition !== 'CREATE_CANDIDATE');
  if (view === 'SAVED') return items.filter((item) => item.decision !== null);
  return items;
}

function ReviewEditor({
  item,
  checksum,
  disabled,
  onSave,
}: {
  item: ReviewItem;
  checksum: string;
  disabled: boolean;
  onSave: (payload: ReviewDecisionInput) => Promise<void>;
}) {
  const [action, setAction] = useState<'CREATE_DRAFT' | 'EXCLUDE'>(
    item.decision?.action ?? (item.disposition === 'CREATE_CANDIDATE' ? 'CREATE_DRAFT' : 'EXCLUDE'),
  );
  const [count, setCount] = useState(
    item.decision?.countedQuantity === null || item.decision?.countedQuantity === undefined
      ? ''
      : String(item.decision.countedQuantity),
  );
  const [reason, setReason] = useState(item.decision?.reason ?? '');
  const [message, setMessage] = useState('');

  function submit() {
    const input = reviewDecisionInput(item, action, count, reason, checksum);
    if (typeof input === 'string') {
      setMessage(input);
      return;
    }
    setMessage('');
    void onSave(input);
  }
  return (
    <div className="meiping-review-editor">
      <label>
        处理方式
        <select
          value={action}
          disabled={disabled}
          onChange={(event) => {
            setAction(event.target.value as 'CREATE_DRAFT' | 'EXCLUDE');
            setMessage('');
          }}
        >
          {item.disposition === 'CREATE_CANDIDATE' && (
            <option value="CREATE_DRAFT">待建商品草稿（不入库）</option>
          )}
          <option value="EXCLUDE">不纳入此次迁移</option>
        </select>
      </label>
      {action === 'CREATE_DRAFT' ? (
        <label>
          人工盘点申报数量
          <input
            aria-label={'源行 ' + item.sourceRowNumber + ' 盘点数量'}
            type="number"
            min={0}
            max={2147483647}
            step={1}
            value={count}
            disabled={disabled}
            placeholder="须自行核对，不能使用假定数量"
            onChange={(event) => setCount(event.target.value)}
          />
        </label>
      ) : (
        <label>
          排除原因
          <input
            aria-label={'源行 ' + item.sourceRowNumber + ' 排除原因'}
            maxLength={500}
            value={reason}
            disabled={disabled}
            placeholder="说明需人工解决的问题"
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      )}
      <div className="meiping-review-save">
        <button className="button-primary" disabled={disabled} onClick={submit}>
          {disabled ? '处理中…' : '保存审核草稿'}
        </button>
        <small>{item.decision ? '已保存版本 ' + item.decision.version : '尚未保存'}</small>
      </div>
      {message && (
        <small className="form-error" role="alert">
          {message}
        </small>
      )}
    </div>
  );
}

function ReviewCorrectionEditor({
  item,
  checksum,
  disabled,
  onSave,
}: {
  item: ReviewItem;
  checksum: string;
  disabled: boolean;
  onSave: (row: number, proposal: ReviewCorrectionInput) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const saved = item.correction?.proposedFields;
  const [values, setValues] = useState({
    title: saved?.title ?? '',
    author: saved?.author ?? '',
    publisher: saved?.publisher ?? '',
    barcode: saved?.barcode ?? '',
    priceYuan: saved?.priceMinor === undefined ? '' : (saved.priceMinor / 100).toFixed(2),
  });
  const [reason, setReason] = useState(item.correction?.reason ?? '');
  const [error, setError] = useState('');

  function submit() {
    const proposal = correctionProposalInput(item, values, reason, checksum);
    if (typeof proposal === 'string') { setError(proposal); return; }
    setError('');
    void onSave(item.sourceRowNumber, proposal);
  }

  return (
    <div className="meiping-correction-editor">
      <button className="secondary" disabled={disabled} onClick={() => setOpen((current) => !current)}>
        {open ? '收起人工纠错建议' : item.correction ? '查看 / 修改已保存纠错建议' : '提出人工纠错建议'}
      </button>
      {item.correction && <small>纠错建议待独立复核 · 版本 {item.correction.version}</small>}
      {open && (
        <>
          <p>仅填写需要修改的字段。这里保存的是人工建议，不会修改原始 Excel、自动解决条码冲突或允许商品入库。</p>
          <div className="meiping-correction-grid">
            {([
              ['title', '建议书名'],
              ['author', '建议作者'],
              ['publisher', '建议出版社'],
              ['barcode', '建议条码'],
              ['priceYuan', '建议定价（元）'],
            ] as const).map(([field, label]) => (
              <label key={field}>
                {label}
                <input
                  aria-label={'源行 ' + item.sourceRowNumber + ' ' + label}
                  value={values[field]}
                  disabled={disabled}
                  onChange={(event) => setValues((prev) => ({ ...prev, [field]: event.target.value }))}
                  placeholder="留空代表不提出修改"
                />
              </label>
            ))}
          </div>
          <label>
            纠错原因（必填）
            <textarea
              aria-label={'源行 ' + item.sourceRowNumber + ' 纠错原因'}
              disabled={disabled}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="如：原始条码重复，建议核对实体书后更正"
            />
          </label>
          {error && <small className="form-error" role="alert">{error}</small>}
          <button className="button-primary" disabled={disabled} onClick={submit}>
            {disabled ? '保存中…' : '保存纠错建议（待复核）'}
          </button>
        </>
      )}
    </div>
  );
}

export function MeipingReviewManager({
  token,
  storeId,
  file,
  report,
  canReview,
  restoredSession,
}: {
  token: string;
  storeId: string;
  canReview: boolean;
} & (
  | { file: File; report: MeipingPreflightReport; restoredSession?: never }
  | { file?: never; report?: never; restoredSession: ReviewSession }
)) {
  const [session, setSession] = useState<ReviewSession | null>(restoredSession ?? null);
  const [page, setPage] = useState<ReviewPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<View>('ALL');
  const [loading, setLoading] = useState(false);
  const [savingRow, setSavingRow] = useState<number | null>(null);
  const [savingCorrection, setSavingCorrection] = useState<number | null>(null);
  const [notice, setNotice] = useState(
    restoredSession ? '已恢复既有审核草稿，未修改商品或库存。' : '',
  );
  const checksum = restoredSession?.sourceChecksum ?? report?.sourceChecksum ?? '';
  const busy = loading || savingRow !== null || savingCorrection !== null;

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setLoading(true);
    setPage(null);
    void getMeipingReviewPage(token, storeId, session.id, offset, PAGE_SIZE)
      .then((next) => {
        if (cancelled) return;
        if (next.sourceChecksum !== session.sourceChecksum) {
          throw new Error('REVIEW_PAGE_CONTEXT_MISMATCH');
        }
        setPage(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice(reviewApiErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, storeId, session, offset]);

  const visible = useMemo(() => filterReviewPage(page?.items ?? [], view), [page, view]);
  const savedOnPage = page?.items.filter((item) => item.decision !== null).length ?? 0;

  async function createSession() {
    if (
      !canReview ||
      !file ||
      !report ||
      session ||
      busy ||
      !checksum ||
      report.sourceStoreId !== storeId
    )
      return;
    setLoading(true);
    setNotice('正在创建审核草稿，只有审核记录会写入数据库…');
    try {
      const created = await createMeipingReviewSession(token, storeId, file);
      if (
        created.storeId !== storeId ||
        created.sourceChecksum !== checksum ||
        created.totalRows !== report.totalRows
      ) {
        setNotice('原文件与预检查结果不一致。请重新选择文件并运行预检查。');
        return;
      }
      setOffset(0);
      setView('ALL');
      setSession(created);
      setNotice(
        created.created
          ? '审核草稿已建立。没有写入商品、SKU 或库存。'
          : '已载入同一门店及文件的既有审核草稿，保存的记录不会丢失。',
      );
    } catch (error) {
      setNotice(reviewApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function save(input: ReviewDecisionInput) {
    if (!session || !page || savingRow !== null) return;
    setSavingRow(input.sourceRowNumber);
    setNotice('');
    try {
      await saveMeipingReviewDecision(token, storeId, session.id, input);
      const refreshed = await getMeipingReviewPage(token, storeId, session.id, offset, PAGE_SIZE);
      if (refreshed.sourceChecksum !== checksum) {
        throw new Error('REVIEW_PAGE_CONTEXT_MISMATCH');
      }
      setPage(refreshed);
      setNotice('源行 ' + input.sourceRowNumber + ' 的审核草稿已保存（未批准、未入库）。');
    } catch (error) {
      setNotice(reviewApiErrorMessage(error) + ' 如遇版本冲突请点击“刷新当前页”。');
    } finally {
      setSavingRow(null);
    }
  }

  async function saveCorrection(sourceRowNumber: number, proposal: ReviewCorrectionInput) {
    if (!session || !page || busy) return;
    setSavingCorrection(sourceRowNumber);
    setNotice('');
    try {
      await saveMeipingReviewCorrection(token, storeId, session.id, sourceRowNumber, proposal);
      const refreshed = await getMeipingReviewPage(token, storeId, session.id, offset, PAGE_SIZE);
      if (refreshed.sourceChecksum !== checksum) throw new Error('REVIEW_PAGE_CONTEXT_MISMATCH');
      setPage(refreshed);
      setNotice('源行 ' + sourceRowNumber + ' 的纠错建议已保存，仍待独立复核；未入库。');
    } catch (error) {
      setNotice(reviewApiErrorMessage(error) + ' 如遇版本冲突，请刷新当前页后核对。');
    } finally {
      setSavingCorrection(null);
    }
  }

  async function refresh() {
    if (!session || busy) return;
    setLoading(true);
    try {
      const refreshed = await getMeipingReviewPage(token, storeId, session.id, offset, PAGE_SIZE);
      if (refreshed.sourceChecksum !== checksum) throw new Error('REVIEW_PAGE_CONTEXT_MISMATCH');
      setPage(refreshed);
      setNotice('已刷新审核草稿。');
    } catch (error) {
      setNotice(reviewApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel meiping-review-section" aria-labelledby="meiping-review-heading">
      <div className="meiping-review-heading">
        <div>
          <span className="badge">人工审核草稿 · 不会正式入库</span>
          <h2 id="meiping-review-heading">商品资料与人工盘点审核</h2>
          <p>
            逐条核对源
            Excel。录入的是待核实的盘点申报，不代表批准库存；不自动合并冲突条码或上架销售。
          </p>
        </div>
        {session && <span className="meiping-readonly">审核状态：草稿 DRAFT</span>}
      </div>
      {!canReview ? (
        <div className="meiping-status" role="status">
          当前账号还需要 inventory.stocktake 权限才能保存人工审核草稿。预检查结果仍可查看。
        </div>
      ) : !session ? (
        <div className="meiping-review-setup">
          <p>
            建立草稿后可保存逐行审核记录。此操作会向审核专用数据表写入会话与审计日志，不会创建正式商品或修改库存。
          </p>
          <button
            className="button-primary"
            disabled={busy || !file || !report || !checksum || report.sourceStoreId !== storeId}
            onClick={() => void createSession()}
          >
            {busy ? '正在建立审核草稿…' : '建立 / 继续本文件的审核草稿'}
          </button>
        </div>
      ) : (
        <>
          <div className="meiping-review-meta">
            <span>原始记录：{session.totalRows} 条</span>
            <span>
              当前页已保存：{savedOnPage} / {page?.items.length ?? 0}
            </span>
            <span>仅供审核，不是全文件审批进度</span>
          </div>
          <div className="meiping-filters">
            <label>
              本页筛选
              <select
                value={view}
                disabled={busy}
                onChange={(event) => setView(event.target.value as View)}
              >
                <option value="ALL">本页全部</option>
                <option value="UNDONE">本页未处理</option>
                <option value="BLOCKED">本页需进一步核对</option>
                <option value="SAVED">本页已保存</option>
              </select>
            </label>
            <button className="secondary" disabled={busy} onClick={() => void refresh()}>
              刷新当前页
            </button>
            <span>只筛选当前 {PAGE_SIZE} 条，其他记录需翻页查看</span>
          </div>
          {loading && <p role="status">正在读取审核记录…</p>}
          {!loading && page && (
            <>
              {visible.length === 0 ? (
                <p>当前页没有符合筛选条件的商品。</p>
              ) : (
                <div className="meiping-review-list">
                  {visible.map((item) => (
                    <article className="meiping-review-item" key={item.sourceRowNumber}>
                      <div className="meiping-review-info">
                        <strong>
                          源行 {item.sourceRowNumber} · {item.normalized.title ?? '缺少书名'}
                        </strong>
                        <span>
                          {item.sourceIdentifiers.barcode
                            ? '条码：' + item.sourceIdentifiers.barcode
                            : '未提供条码'}{' '}
                          · 商品编号：{item.sourceIdentifiers.bookCode ?? '—'}
                        </span>
                        <span>
                          作者：{item.normalized.author ?? '待完善'} · 出版社：
                          {item.normalized.publisher ?? '待完善'} · 定价：
                          {item.normalized.priceMinor === null
                            ? '待确认'
                            : '¥' + (item.normalized.priceMinor / 100).toFixed(2)}
                        </span>
                        <span>
                          来源分类：
                          {item.disposition === 'CREATE_CANDIDATE'
                            ? '可提出建档草稿'
                            : '需人工解决 / 不可自动建档'}
                        </span>
                        {item.issueCodes.length > 0 && (
                          <small>
                            审核事项：
                            {item.issueCodes.map((code) => issueLabels[code] ?? code).join('、')}
                          </small>
                        )}
                        {item.saleBlocked && (
                          <small className="form-error">禁止正常销售，需后续独立审核</small>
                        )}
                      </div>
                      <ReviewEditor
                        key={item.sourceRowNumber + ':' + (item.decision?.version ?? 0)}
                        item={item}
                        checksum={session.sourceChecksum}
                        disabled={busy}
                        onSave={save}
                      />
                      <ReviewCorrectionEditor
                        key={'correction:' + item.sourceRowNumber + ':' + (item.correction?.version ?? 0)}
                        item={item}
                        checksum={session.sourceChecksum}
                        disabled={busy}
                        onSave={saveCorrection}
                      />
                    </article>
                  ))}
                </div>
              )}
              <div className="meiping-review-pagination">
                <button
                  disabled={busy || offset === 0}
                  onClick={() => {
                    setOffset(Math.max(0, offset - PAGE_SIZE));
                    setView('ALL');
                  }}
                >
                  上一页
                </button>
                <span>
                  第 {Math.floor(offset / PAGE_SIZE) + 1} / {Math.ceil(page.totalRows / PAGE_SIZE)}{' '}
                  页
                </span>
                <button
                  disabled={busy || offset + PAGE_SIZE >= page.totalRows}
                  onClick={() => {
                    setOffset(offset + PAGE_SIZE);
                    setView('ALL');
                  }}
                >
                  下一页
                </button>
              </div>
            </>
          )}
        </>
      )}
      {notice && (
        <p className="meiping-status" role="status">
          {notice}
        </p>
      )}
      <p className="meiping-review-warning">
        本页面只存储 DRAFT 审核决定。条码冲突、人工确认、独立审批、正式建档与 INITIAL_MIGRATION
        库存流水均需后续流程。
      </p>
    </section>
  );
}
