import { useState, type FormEvent } from 'react';
import {
  downloadStoreMeipingExceptions,
  previewStoreMeiping,
  validateMeipingFile,
  type StoreMeipingPreflight,
} from './store-meiping-preflight-api';

export function StoreMeipingPreflightPanel({ token, storeId }: { token: string; storeId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<StoreMeipingPreflight | null>(null);
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('选择门店对应的美萍 Excel 后执行只读预检查。');
  const current =
    report !== null && file !== null && file === reportFile && report.sourceStoreId === storeId;

  function selectFile(next: File | null) {
    setReport(null);
    setReportFile(null);
    const error = validateMeipingFile(next);
    setFile(error ? null : next);
    setMessage(error ?? '文件已选择，可以开始预检查；不会写入真实库存。');
  }

  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    setReport(null);
    setReportFile(null);
    setBusy(true);
    setMessage('正在读取 Excel 并检查商品及库存异常…');
    try {
      const result = await previewStoreMeiping(token, storeId, file);
      setReport(result);
      setReportFile(file);
      setMessage('预检查完成：仅生成核对结果，未新增商品或更改库存。');
    } catch (error) {
      setMessage(error instanceof Error ? `预检查失败：${error.message}` : '预检查失败');
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!file || !current || busy) return;
    setBusy(true);
    try {
      const csv = await downloadStoreMeipingExceptions(token, storeId, file);
      const url = URL.createObjectURL(csv);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'meiping-exceptions.csv';
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage('已下载异常明细。修改源资料后请重新预检查。');
    } catch (error) {
      setMessage(error instanceof Error ? `下载失败：${error.message}` : '下载失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Excel 批量导入预检查" className="panel">
      <h3>Excel 批量导入准备（东门店适用）</h3>
      <p>
        可先检查现有美萍 .xls/.xlsx 的商品、条码和异常。导入前必须核对实际库存数量；原表「每条暂算 1
        件」不是实盘结果。 这里不创建商品、不改库存，正式导入仍使用现有的审核与对账流程。
      </p>
      <form className="operation-form" onSubmit={(event) => void preview(event)}>
        <label>
          美萍 Excel 文件（最大 5 MiB）
          <input
            aria-label="选择美萍 Excel 文件"
            type="file"
            accept=".xls,.xlsx"
            disabled={busy}
            onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <button disabled={!file || busy}>{busy ? '检查中…' : '预检查 Excel'}</button>
      </form>
      {current && report && (
        <div aria-label="Excel 预检查结果">
          <p>
            源记录：{report.totalRows} · 已匹配：{report.matchedRows} · 新建候选：
            {report.createCandidateRows}
          </p>
          <p>
            异常：{report.exceptionRows} · 阻断：{report.blockingRows} · 资料待完善：
            {report.metadataWarningRows} · 禁止销售：{report.saleBlockedRows}
          </p>
          <p>待实盘的暂定库存行：{report.assumedInventoryRows}（尚未批准或导入）</p>
          <button type="button" disabled={busy} onClick={() => void download()}>
            下载异常明细 CSV
          </button>
        </div>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
