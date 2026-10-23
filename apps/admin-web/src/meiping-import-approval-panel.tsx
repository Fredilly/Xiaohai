import { useState } from 'react';
import {
  approveMeipingImport,
  executeMeipingImport,
  previewMeipingImport,
  type MeipingImportPreview,
} from './meiping-review-api';

export function MeipingImportApprovalPanel({
  token,
  storeId,
  sessionId,
  canPreview,
  canApprove,
  canExecute,
}: {
  token: string;
  storeId: string;
  sessionId: string;
  canPreview: boolean;
  canApprove: boolean;
  canExecute: boolean;
}) {
  const [preview, setPreview] = useState<MeipingImportPreview | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function runPreview() {
    setBusy(true);
    setStatus('正在生成导入预览…');
    try {
      setPreview(await previewMeipingImport(token, storeId, sessionId));
      setStatus('预览已保存。仅独立最终批准后才可能执行。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '预览失败');
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!preview) return;
    setBusy(true);
    try {
      await approveMeipingImport(token, storeId, preview.batchId);
      setStatus('已记录独立最终导入批准；仍需执行开关开启后才能写入。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '批准失败');
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!preview) return;
    setBusy(true);
    try {
      await executeMeipingImport(token, storeId, preview.batchId);
      setStatus('导入执行完成，已生成对账结果。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '执行失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel meiping-import-approval" aria-labelledby="meiping-import-title">
      <span className="badge">安全导入 · 独立批准</span>
      <h3 id="meiping-import-title">导入预览与对账</h3>
      <p>
        这里读取已保存的审核决定和纠错版本。纠错 ACCEPTED 不等于整批授权；执行默认关闭，且不使用
        Excel 推断库存。
      </p>
      <div className="meiping-summary">
        <div>
          <strong>{preview?.plan.totalRows ?? '—'}</strong>
          <span>源行</span>
        </div>
        <div>
          <strong>{preview?.plan.includedRows ?? '—'}</strong>
          <span>待写入</span>
        </div>
        <div>
          <strong>{preview?.plan.excludedRows ?? '—'}</strong>
          <span>排除</span>
        </div>
        <div>
          <strong>
            {preview?.plan.rows.reduce((sum, row) => sum + row.countedQuantity, 0) ?? '—'}
          </strong>
          <span>人工盘点数量</span>
        </div>
      </div>
      {preview?.plan.conflicts.length ? (
        <p className="form-error">
          存在 {preview.plan.conflicts.length} 条冲突，必须人工处理后重新预览。
        </p>
      ) : null}
      <div className="button-row">
        {canPreview && (
          <button className="secondary" disabled={busy} onClick={() => void runPreview()}>
            {busy ? '处理中…' : '生成 Dry Run 预览'}
          </button>
        )}
        {canApprove && preview && (
          <button className="button-primary" disabled={busy} onClick={() => void approve()}>
            记录独立最终批准
          </button>
        )}
        {canExecute && preview?.canExecute && (
          <button className="button-primary" disabled={busy} onClick={() => void execute()}>
            执行隔离导入
          </button>
        )}
      </div>
      {status && (
        <p className="meiping-status" role="status">
          {status}
        </p>
      )}
      <small>
        导入只包含图书主数据、SKU 和当前人工盘点库存，不包含会员、订单、财务或历史租借。
      </small>
    </section>
  );
}
