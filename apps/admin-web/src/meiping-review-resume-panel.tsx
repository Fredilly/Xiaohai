import { useEffect, useState } from 'react';
import { listMeipingReviewSessions, type ReviewSessionSummary } from './meiping-review-api';
import { reviewApiErrorMessage } from './meiping-review-form';
import { MeipingReviewManager } from './meiping-review-manager';

const PAGE_SIZE = 20;

/** Read-only discovery; opening a session rechecks store permissions server-side. */
export function MeipingReviewResumePanel({
  token,
  storeId,
  canReadReview,
  canEditReview,
  canVerifyCorrection,
  canImportPreview = false,
  canImportApprove = false,
  canImportExecute = false,
}: {
  token: string;
  storeId: string;
  canReadReview: boolean;
  canEditReview: boolean;
  canVerifyCorrection?: boolean;
  canImportPreview?: boolean;
  canImportApprove?: boolean;
  canImportExecute?: boolean;
}) {
  const [items, setItems] = useState<ReviewSessionSummary[]>([]);
  const [selected, setSelected] = useState<ReviewSessionSummary | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canReadReview || !storeId) return;
    let cancelled = false;
    setLoading(true);
    setItems([]);
    setError('');
    void listMeipingReviewSessions(token, storeId, offset, PAGE_SIZE)
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setHasMore(result.hasMore);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(reviewApiErrorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, storeId, canReadReview, offset, retry]);

  if (!canReadReview || !storeId) return null;
  return (
    <section className="panel meiping-resume-section" aria-labelledby="meiping-resume-title">
      <div>
        <span className="badge">已有审核草稿 · 只读查询</span>
        <h2 id="meiping-resume-title">继续之前的人工审核</h2>
        <p>选择当前授权门店的 DRAFT 草稿，无需重新上传 Excel。仍需逐条人工核对，不代表正式入库。</p>
      </div>
      {selected ? (
        <>
          <div className="meiping-resume-actions">
            <button
              className="secondary"
              onClick={() => {
                setSelected(null);
                setRetry((value) => value + 1);
              }}
            >
              返回草稿列表
            </button>
            <span>已选草稿 · {selected.totalRows} 条来源记录</span>
          </div>
          <MeipingReviewManager
            key={selected.id}
            token={token}
            storeId={storeId}
            canReadReview={canReadReview}
            canEditReview={canEditReview}
            canVerifyCorrection={canVerifyCorrection}
            canImportPreview={canImportPreview}
            canImportApprove={canImportApprove}
            canImportExecute={canImportExecute}
            restoredSession={{
              id: selected.id,
              created: false,
              status: selected.status,
              storeId: selected.storeId,
              sourceChecksum: selected.sourceChecksum,
              totalRows: selected.totalRows,
              approved: false,
              catalogOrInventoryWritten: false,
            }}
          />
        </>
      ) : (
        <>
          <div className="meiping-resume-actions">
            <button className="secondary" disabled={loading} onClick={() => setRetry((n) => n + 1)}>
              {loading ? '正在查询…' : '刷新草稿列表'}
            </button>
            <span>每页最多 {PAGE_SIZE} 个，按创建时间显示</span>
          </div>
          {loading && <p role="status">正在读取已有审核草稿…</p>}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {!loading && !error && items.length === 0 && (
            <p>当前门店暂无审核草稿，可以先上传 Excel 并进行只读预检查。</p>
          )}
          {!loading && !error && items.length > 0 && (
            <div className="meiping-resume-list">
              {items.map((item) => (
                <div key={item.id} className="meiping-resume-item">
                  <div>
                    <strong>DRAFT · {item.totalRows} 条商品记录</strong>
                    <small>
                      创建于 {new Date(item.createdAt).toLocaleString('zh-CN')} · 已保存审核决定{' '}
                      {item.savedDecisions} / {item.totalRows}
                    </small>
                    <small>文件校验值：{item.sourceChecksum.slice(0, 12)}…</small>
                  </div>
                  <button onClick={() => setSelected(item)}>继续审核</button>
                </div>
              ))}
            </div>
          )}
          <div className="meiping-review-pagination">
            <button
              disabled={loading || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              上一页
            </button>
            <span>第 {Math.floor(offset / PAGE_SIZE) + 1} 页</span>
            <button disabled={loading || !hasMore} onClick={() => setOffset(offset + PAGE_SIZE)}>
              下一页
            </button>
          </div>
        </>
      )}
      <p className="meiping-review-warning">
        继续审核只读取已保存的草稿；不会创建商品、SKU、库存或库存流水。上传新 Excel
        请使用上方预检查入口。
      </p>
    </section>
  );
}
