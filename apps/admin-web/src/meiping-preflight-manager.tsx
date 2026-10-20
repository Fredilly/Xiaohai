import { useEffect, useMemo, useRef, useState } from 'react';
import type { StaffMeResponse } from '@xiaohai/contracts';
import { MEIPING_PREFLIGHT_MAX_BYTES, MEIPING_PREFLIGHT_MAX_MIB } from '@xiaohai/contracts/meiping';
import { loadHqStores } from './hq-operations-api';
import { MeipingReviewManager } from './meiping-review-manager';
import { MeipingReviewResumePanel } from './meiping-review-resume-panel';
import { meipingReviewPermissions } from './meiping-review-permissions';
import {
  downloadMeipingExceptions,
  MeipingPreflightApiError,
  preflightMeipingFile,
  type MeipingIssue,
  type MeipingPreflightReport,
  type MeipingPreflightRow,
} from './meiping-preflight-api';

type IssueFilter = string;

const issueLabels: Record<string, string> = {
  AUTHOR_MISSING: '缺少作者',
  PUBLISHER_MISSING: '缺少出版社',
  MISSING_TITLE: '缺少书名',
  MISSING_BOOK_CODE: '缺少商品编号',
  MISSING_BARCODE: '缺少商品条码',
  ZERO_PRICE: '零定价',
  DUPLICATE_BARCODE: '重复条码',
  BARCODE_CONFLICT: '条码资料冲突',
  UNKNOWN_CATEGORY: '未知类别',
  NON_BOOK_CATEGORY: '非图书类别',
  CATEGORY_UNKNOWN: '类别无法判断',
  FORMULA_ROW_REVIEW: '公式商品行',
  DUPLICATE_ROW: '重复商品记录',
  BOOK_CODE_CONFLICT: '商品编号冲突',
  INTERNAL_CODE_CONFLICT: '自有编号冲突',
  MISSING_COLUMN_TITLE: '缺少书名列',
  MISSING_COLUMN_PRICE: '缺少价格列',
};

export function filterMeipingRows(rows: MeipingPreflightRow[], filter: IssueFilter) {
  if (filter === 'ALL') return rows;
  if (filter === 'WARNING' || filter === 'ERROR') {
    return rows.filter((row) => row.issues.some((issue) => issue.severity === filter));
  }
  return rows.filter((row) => row.issues.some((issue) => issue.code === filter));
}

export function issueSummary(rows: MeipingPreflightRow[]) {
  const summary = new Map<string, { count: number; severity: MeipingIssue['severity'] }>();
  for (const row of rows) {
    for (const issue of row.issues) {
      const existing = summary.get(issue.code);
      summary.set(issue.code, {
        count: (existing?.count ?? 0) + 1,
        severity:
          existing?.severity === 'ERROR' || issue.severity === 'ERROR' ? 'ERROR' : 'WARNING',
      });
    }
  }
  return [...summary.entries()].map(([code, value]) => ({ code, ...value }));
}

function fileExtension(name: string) {
  return name.toLowerCase().endsWith('.xls') || name.toLowerCase().endsWith('.xlsx');
}

export function formatPrice(value: number | null) {
  return value === null
    ? '—'
    : new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value / 100);
}

export function meipingMaxFileSizeLabel() {
  return `Excel 文件（最大 ${MEIPING_PREFLIGHT_MAX_MIB} MiB）`;
}

export function isReportCurrent(
  reportStoreId: string | null,
  reportFile: File | null,
  selectedStoreId: string,
  selectedFile: File | null,
) {
  return Boolean(
    reportStoreId && reportFile && reportStoreId === selectedStoreId && reportFile === selectedFile,
  );
}

function renderIssue(issue: MeipingIssue) {
  return (
    <li key={`${issue.sourceRowNumber}-${issue.code}`}>
      <span className={`meiping-severity meiping-severity-${issue.severity.toLowerCase()}`}>
        {issue.severity === 'ERROR' ? '严重' : '警告'}
      </span>{' '}
      {issueLabels[issue.code] ?? issue.code}: {issue.message}
    </li>
  );
}

export function MeipingPreflightManager({ token, me }: { token: string; me: StaffMeResponse }) {
  const permissions = useMemo(() => new Set(me.permissions), [me.permissions]);
  const canPreflight = permissions.has('inventory.receive');
  const { canReadReview, canEditReview, canVerifyCorrection } = meipingReviewPermissions(
    me.permissions,
  );
  const canReadStores = permissions.has('stores.read');
  const [stores, setStores] = useState<Awaited<ReturnType<typeof loadHqStores>> | null>(null);
  const [storeId, setStoreId] = useState('');
  const [file, setFile] = useState<(File & { readonly name: string }) | null>(null);
  const [report, setReport] = useState<MeipingPreflightReport | null>(null);
  const [reportStoreId, setReportStoreId] = useState<string | null>(null);
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [filter, setFilter] = useState<IssueFilter>('ALL');
  const [status, setStatus] = useState('');
  const [loadingStores, setLoadingStores] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!canReadStores) return;
    let cancelled = false;
    setLoadingStores(true);
    void loadHqStores(token)
      .then((result) => {
        if (cancelled) return;
        setStores(result);
        if (result.stores.length === 1) {
          setStoreId((current) => current || result.stores[0]!.id);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : 'STORE_LOAD_FAILED');
      })
      .finally(() => {
        if (!cancelled) setLoadingStores(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canReadStores, token]);

  const reportRows = report ? filterMeipingRows(report.rows, filter) : [];
  const issueKinds = report ? issueSummary(report.rows) : [];
  const selectedStore = stores?.stores.find((store) => store.id === storeId);
  const reportIsCurrent = isReportCurrent(reportStoreId, reportFile, storeId, file);

  if (!canPreflight) {
    return (
      <section className="panel meiping-panel">
        <span className="badge">权限不足</span>
        <h2>美萍导入预检查</h2>
        <p>当前账号没有 inventory.receive 权限，不能上传或预检查文件。</p>
      </section>
    );
  }

  if (!canReadStores) {
    return (
      <section className="panel meiping-panel">
        <span className="badge">权限不足</span>
        <h2>美萍导入预检查</h2>
        <p>需要 stores.read 权限才能选择已授权门店，当前不会发送文件请求。</p>
      </section>
    );
  }

  function chooseFile(next: File | undefined) {
    setReport(null);
    setReportStoreId(null);
    setReportFile(null);
    setFilter('ALL');
    if (!next) {
      setFile(null);
      setStatus('');
      return;
    }
    if (!fileExtension(next.name)) {
      setFile(null);
      setStatus('文件格式不支持，请选择 .xls 或 .xlsx 文件。');
      return;
    }
    if (next.size > MEIPING_PREFLIGHT_MAX_BYTES) {
      setFile(null);
      setStatus('文件超过 5 MB 限制，请拆分后重试。');
      return;
    }
    setFile(next);
    setStatus('');
  }

  async function submit() {
    if (!storeId || !file) {
      setStatus('请先选择授权门店和 Excel 文件。');
      return;
    }
    setBusy(true);
    setReport(null);
    setReportStoreId(null);
    setReportFile(null);
    setStatus('正在读取并生成预检查报告…');
    try {
      const nextReport = await preflightMeipingFile(token, storeId, file);
      setReport(nextReport);
      setReportStoreId(storeId);
      setReportFile(file);
      setFilter('ALL');
      setStatus('预检查完成：未写入商品、SKU 或库存。');
    } catch (error: unknown) {
      if (error instanceof MeipingPreflightApiError) {
        const messages: Record<number, string> = {
          400: '文件格式或内容无法识别，请检查原始 Excel。',
          401: '登录状态已失效，请重新登录后台。',
          403: '当前账号没有该门店的预检查权限。',
          413: '文件超过服务端大小限制，请拆分后重试。',
        };
        setStatus(messages[error.status] ?? `上传预检查失败（HTTP ${error.status}）。`);
      } else {
        setStatus('上传预检查失败，请检查网络后重试。');
      }
    } finally {
      setBusy(false);
    }
  }

  async function downloadCsv() {
    if (!file || !storeId || !reportIsCurrent) return;
    setBusy(true);
    try {
      const csv = await downloadMeipingExceptions(token, storeId, file);
      const url = URL.createObjectURL(csv);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${file.name.replace(/\.(xlsx?|XLSX?)$/, '')}-exceptions.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setStatus('异常报告下载失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="meiping-panel">
      <div className="panel meiping-intro">
        <div className="meiping-heading">
          <div>
            <span className="badge">只读预检查</span>
            <h2>美萍 Excel 导入预检查</h2>
            <p>先选择已授权门店并查看解析结果。当前版本不会写入商品、SKU 或库存。</p>
          </div>
          <span className="meiping-readonly">正式入库：未开放</span>
        </div>
        <div className="meiping-upload-grid">
          <label>
            授权门店
            <select
              value={storeId}
              disabled={loadingStores || busy}
              onChange={(event) => {
                setStoreId(event.target.value);
                setReport(null);
                setReportStoreId(null);
                setReportFile(null);
                setFilter('ALL');
                setStatus('门店已切换，请重新执行预检查。');
              }}
            >
              <option value="">{loadingStores ? '门店加载中…' : '请选择门店'}</option>
              {stores?.stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}（{store.code}）
                </option>
              ))}
            </select>
          </label>
          <label>
            {meipingMaxFileSizeLabel()}
            <input
              ref={inputRef}
              type="file"
              accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
          </label>
        </div>
        <div className="meiping-upload-actions">
          <span>
            {selectedStore ? `当前门店：${selectedStore.name}` : '仅可使用服务端返回的授权门店'}
          </span>
          <div className="button-row">
            <button disabled={busy || !file || !storeId} onClick={() => void submit()}>
              {busy ? '处理中…' : '开始只读预检查'}
            </button>
            <button
              className="secondary"
              disabled={busy || !reportIsCurrent}
              onClick={() => void downloadCsv()}
            >
              下载问题明细 CSV
            </button>
          </div>
        </div>
        {status && (
          <p className="meiping-status" role="alert">
            {status}
          </p>
        )}
      </div>

      {!reportIsCurrent && (
        <MeipingReviewResumePanel
          key={storeId}
          token={token}
          storeId={storeId}
          canReadReview={canReadReview}
          canEditReview={canEditReview}
          canVerifyCorrection={canVerifyCorrection}
        />
      )}
      {!report ? (
        <div className="panel empty-state meiping-empty">
          <strong>等待上传 Excel</strong>
          <span>这里将展示商品数量、异常原因和待盘点库存计划。</span>
        </div>
      ) : (
        <>
          <div className="meiping-summary">
            <div>
              <strong>{report.totalRows}</strong>
              <span>商品记录</span>
            </div>
            <div>
              <strong>{report.createCandidateRows}</strong>
              <span>新建候选</span>
            </div>
            <div>
              <strong>{report.blockingRows}</strong>
              <span>需要人工审核</span>
            </div>
            <div>
              <strong>{report.metadataWarningRows}</strong>
              <span>资料待完善</span>
            </div>
            <div>
              <strong>{report.saleBlockedRows}</strong>
              <span>禁止正常销售</span>
            </div>
            <div>
              <strong>{report.assumedInventoryRows}</strong>
              <span>计划库存（待盘点）</span>
            </div>
            <div>
              <strong>{report.plannedInventoryTotal}</strong>
              <span>假定库存总量</span>
            </div>
          </div>
          <section className="panel meiping-report">
            <div className="meiping-report-heading">
              <div>
                <h2>预检查结果</h2>
                <p>
                  来源门店：{report.sourceStoreCode} · {report.headers.length} 列 · 清单校验值：
                  {report.sourceChecksum ?? '未提供'}
                </p>
              </div>
              <span className="badge">库存审批：待管理员审核</span>
            </div>
            <div className="meiping-filters" aria-label="异常筛选">
              <label>
                显示范围
                <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                  <option value="ALL">全部记录（{report.rows.length}）</option>
                  <option value="ERROR">
                    严重错误（
                    {
                      report.rows.filter((row) =>
                        row.issues.some((issue) => issue.severity === 'ERROR'),
                      ).length
                    }
                    ）
                  </option>
                  <option value="WARNING">
                    警告（
                    {
                      report.rows.filter((row) =>
                        row.issues.some((issue) => issue.severity === 'WARNING'),
                      ).length
                    }
                    ）
                  </option>
                  {issueKinds.map((kind) => (
                    <option key={kind.code} value={kind.code}>
                      {issueLabels[kind.code] ?? kind.code}（{kind.count}）
                    </option>
                  ))}
                </select>
              </label>
              <span>当前显示 {reportRows.length} 条</span>
            </div>
            <div className="meiping-legend">
              建档候选不会因为作者或出版社缺失而被阻断；需要人工审核：{report.blockingRows} 条；
              资料待完善：{report.metadataWarningRows} 条；禁止正常销售：{report.saleBlockedRows}{' '}
              条。
            </div>
            {reportRows.length === 0 ? (
              <div className="empty-state">
                <strong>没有符合条件的记录</strong>
              </div>
            ) : (
              <div className="table-wrap meiping-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>源行</th>
                      <th>商品信息</th>
                      <th>来源标识</th>
                      <th>定价</th>
                      <th>计划库存</th>
                      <th>审核事项</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportRows.map((row) => (
                      <MeipingRow key={row.sourceRowNumber} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {reportIsCurrent && file && (
            <MeipingReviewManager
              key={storeId + ':' + (report.sourceChecksum ?? '')}
              token={token}
              storeId={storeId}
              file={file}
              report={report}
              canReadReview={canReadReview}
              canEditReview={canEditReview}
              canVerifyCorrection={canVerifyCorrection}
            />
          )}
          <section className="panel meiping-future">
            <span className="badge">尚未开放</span>
            <h3>正式入库与独立审批</h3>
            <p>
              当前只生成预检查结果。管理员审核匹配、异常和实际盘点数量后，才可在后续版本进入带审计和幂等保护的
              INITIAL_MIGRATION 入库流程。
            </p>
          </section>
        </>
      )}
    </section>
  );
}

function MeipingRow({ row }: { row: MeipingPreflightRow }) {
  const identifier =
    [
      row.sourceIdentifiers.bookCode && `编号 ${row.sourceIdentifiers.bookCode}`,
      row.sourceIdentifiers.internalCode && `自有 ${row.sourceIdentifiers.internalCode}`,
      row.sourceIdentifiers.barcode && `条码 ${row.sourceIdentifiers.barcode}`,
    ]
      .filter(Boolean)
      .join(' · ') || '无外部标识';
  return (
    <tr>
      <td>{row.sourceRowNumber}</td>
      <td>
        <strong>{row.normalized.title ?? '未填写书名'}</strong>
        <small>
          {row.sourceCategory ?? '未分类'} · {row.sourceCategoryType}
        </small>
      </td>
      <td>
        <code>{identifier}</code>
      </td>
      <td>{formatPrice(row.normalized.priceMinor)}</td>
      <td>
        <strong>1 本</strong>
        <small>待盘点</small>
      </td>
      <td>
        {row.issues.length ? (
          <div>
            {row.blockingIssues.length > 0 && (
              <>
                <strong>人工审核</strong>
                <ul className="meiping-issues">{row.blockingIssues.map(renderIssue)}</ul>
              </>
            )}
            {row.metadataWarnings.length > 0 && (
              <>
                <strong>资料待完善</strong>
                <ul className="meiping-issues">{row.metadataWarnings.map(renderIssue)}</ul>
              </>
            )}
            {row.saleBlocked.length > 0 && (
              <>
                <strong>禁止正常销售</strong>
                <ul className="meiping-issues">{row.saleBlocked.map(renderIssue)}</ul>
              </>
            )}
          </div>
        ) : (
          <span className="meiping-clear">无异常</span>
        )}
      </td>
    </tr>
  );
}
