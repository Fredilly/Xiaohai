import { useEffect, useState, type FormEvent } from 'react';
import type { StoreCatalogItem } from '@xiaohai/contracts/commerce';
import {
  createCatalogCorrection,
  listCatalogCorrections,
  reviewCatalogCorrection,
} from './catalog-correction-api';
import { listStoreCatalog } from './store-catalog-api';

type Correction = Awaited<ReturnType<typeof listCatalogCorrections>>['requests'][number];
type Field = 'productName' | 'bookTitle' | 'author' | 'publisher' | 'isbn' | 'priceMinor';
const fields: { key: Field; label: string }[] = [
  { key: 'productName', label: '商品名称' },
  { key: 'bookTitle', label: '图书书名' },
  { key: 'author', label: '作者' },
  { key: 'publisher', label: '出版社' },
  { key: 'isbn', label: 'ISBN' },
  { key: 'priceMinor', label: 'SKU 价格（元）' },
];
const fieldNames = Object.fromEntries(fields.map((x) => [x.key, x.label]));

export function CatalogCorrectionPanel({
  token,
  storeId,
  storeName,
  permissions,
  staffAccountId,
}: {
  token: string;
  storeId: string;
  storeName: string;
  permissions: readonly string[];
  staffAccountId: string;
}) {
  const canSubmit =
    permissions.includes('stores.read') &&
    permissions.includes('inventory.read') &&
    permissions.includes('inventory.stocktake');
  const canReview =
    permissions.includes('stores.read') && permissions.includes('catalog.correction.review');
  const [requests, setRequests] = useState<Correction[]>([]);
  const [items, setItems] = useState<StoreCatalogItem[]>([]);
  const [searchText, setSearchText] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [skuId, setSkuId] = useState('');
  const [field, setField] = useState<Field>('productName');
  const [proposedValue, setProposedValue] = useState('');
  const [reason, setReason] = useState('');
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('读取商品纠错记录中…');

  useEffect(() => {
    let active = true;
    void listCatalogCorrections(token, storeId)
      .then((result) => {
        if (!active) return;
        setRequests(result.requests);
        setStatus(
          result.requests.length ? '仅为建议记录，不改变正式商品' : '当前门店暂无商品纠错申请',
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        setRequests([]);
        setStatus(error instanceof Error ? error.message : '读取纠错申请失败');
      });
    return () => {
      active = false;
    };
  }, [token, storeId, refresh]);

  useEffect(() => {
    if (!canSubmit) return;
    let active = true;
    void listStoreCatalog(token, storeId, { q: appliedSearch, limit: 100 })
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setSkuId((current) => (page.items.some((item) => item.skuId === current) ? current : ''));
        if (page.hasMore) setStatus('只显示前 100 条，请用搜索缩小商品范围');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setItems([]);
        setSkuId('');
        setStatus(error instanceof Error ? error.message : '加载商品失败');
      });
    return () => {
      active = false;
    };
  }, [token, storeId, appliedSearch, canSubmit, refresh]);

  const selected = items.find((item) => item.skuId === skuId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || busy) return;
    const value = field === 'priceMinor' ? priceToMinor(proposedValue) : proposedValue.trim();
    if (value === null) {
      setStatus('价格请输入正确的人民币金额，最多保留两位小数');
      return;
    }
    if (!window.confirm('确认提交纠错申请？不会修改正式商品或库存。')) return;
    setBusy(true);
    try {
      await createCatalogCorrection(token, storeId, {
        skuId: selected.skuId,
        expectedInventoryVersion: selected.inventoryVersion,
        field,
        proposedValue: value,
        reason: reason.trim(),
      });
      setProposedValue('');
      setReason('');
      setStatus('纠错申请已提交，等待独立复核；正式商品尚未修改');
      setRefresh((n) => n + 1);
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : '提交失败');
    } finally {
      setBusy(false);
    }
  }

  async function decide(request: Correction, verdict: 'ACCEPTED' | 'REJECTED') {
    if (busy || !canReview) return;
    const reason = reviewReasons[request.id]?.trim();
    if (!reason) {
      setStatus('请先填写独立复核理由');
      return;
    }
    if (
      !window.confirm(
        '确认' + (verdict === 'ACCEPTED' ? '采纳建议' : '驳回建议') + '？这不会修改正式商品。',
      )
    )
      return;
    setBusy(true);
    try {
      await reviewCatalogCorrection(token, storeId, request.id, { verdict, reason });
      setReviewReasons((all) => ({ ...all, [request.id]: '' }));
      setStatus('独立复核已记录；建议仍不会自动写入商品或库存');
      setRefresh((n) => n + 1);
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : '复核失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <span className="tag">日常商品管理 · 仅纠错申请与复核</span>
      <h2>商品资料纠错</h2>
      <p>当前门店：{storeName}。本功能与一次性美萍迁移分开。</p>
      <p>
        所有书名、作者、出版社、ISBN 和 SKU
        价格都是共享商品资料。采纳仅代表建议复核通过，不会直接改价、改书目或更改库存；正式生效需要后续总部流程。
      </p>
      {canSubmit && (
        <>
          <h3>提交纠错申请</h3>
          <form
            className="book-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              setAppliedSearch(searchText.trim());
            }}
          >
            <input
              aria-label="搜索待纠错商品"
              value={searchText}
              maxLength={120}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="书名、作者、ISBN、SKU"
            />
            <button>搜索本店商品</button>
          </form>
          <form className="catalog-correction-form" onSubmit={(event) => void submit(event)}>
            <label>
              选择商品
              <select
                required
                value={skuId}
                onChange={(event) => {
                  setSkuId(event.target.value);
                  setField('productName');
                  setProposedValue('');
                }}
              >
                <option value="">请选择</option>
                {items.map((item) => (
                  <option value={item.skuId} key={item.skuId}>
                    {item.bookTitle || item.productName} · {item.skuCode}
                  </option>
                ))}
              </select>
            </label>
            <label>
              拟更正字段
              <select value={field} onChange={(event) => setField(event.target.value as Field)}>
                {selectableCorrectionFields(selected?.bookTitle).map((option) => (
                  <option value={option.key} key={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              建议内容
              <input
                required
                value={proposedValue}
                maxLength={200}
                onChange={(event) => setProposedValue(event.target.value)}
                placeholder={field === 'priceMinor' ? '例如 28.50 元' : '填写更正后的内容'}
              />
            </label>
            <label>
              依据 / 纠错理由
              <textarea
                required
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <button disabled={busy || !selected || !reason.trim() || !proposedValue.trim()}>
              {busy ? '处理中…' : '提交纠错建议（不改商品）'}
            </button>
          </form>
        </>
      )}
      <h3>本店纠错记录（最近 50 条）</h3>
      {requests.map((request) => (
        <article className="book-result" key={request.id}>
          <div>
            <strong>
              {fieldNames[request.field]} · {correctionStatus(request.status)}
            </strong>
            <span>SKU：{request.skuId}</span>
            <span>原值：{request.originalValue ?? '未填写'}</span>
            <span>
              建议：{request.proposedValue}
              {request.field === 'priceMinor' ? ' 分' : ''}
            </span>
            <small>申请理由：{request.reason}</small>
            <small>申请时间：{new Date(request.createdAt).toLocaleString()}</small>
            {request.reviewReason && <small>复核理由：{request.reviewReason}</small>}
          </div>
          {canReview &&
            request.status === 'PENDING' &&
            (isOwnCorrection(request.requestedByStaffAccountId, staffAccountId) ? (
              <p>本人提交的建议需由另一名授权人员独立复核。</p>
            ) : (
              <div>
                <label>
                  独立复核理由
                  <textarea
                    value={reviewReasons[request.id] ?? ''}
                    rows={2}
                    maxLength={500}
                    onChange={(event) =>
                      setReviewReasons((all) => ({ ...all, [request.id]: event.target.value }))
                    }
                  />
                </label>
                <button
                  disabled={busy || !reviewReasons[request.id]?.trim()}
                  onClick={() => void decide(request, 'ACCEPTED')}
                >
                  采纳建议（不改商品）
                </button>
                <button
                  disabled={busy || !reviewReasons[request.id]?.trim()}
                  onClick={() => void decide(request, 'REJECTED')}
                >
                  驳回建议
                </button>
              </div>
            ))}
        </article>
      ))}
      <p role="status">{status}</p>
    </section>
  );
}

export function selectableCorrectionFields(bookTitle: string | null | undefined) {
  return fields.filter(
    (option) =>
      Boolean(bookTitle) ||
      !['bookTitle', 'author', 'publisher', 'isbn'].includes(option.key),
  );
}

export function isOwnCorrection(requesterStaffAccountId: string, currentStaffAccountId: string) {
  return requesterStaffAccountId === currentStaffAccountId;
}

export function correctionStatus(value: Correction['status']) {
  return { PENDING: '待独立复核', ACCEPTED: '已采纳建议（未生效）', REJECTED: '已驳回' }[value];
}

export function priceToMinor(value: string): string | null {
  const text = value.trim();
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(text)) return null;
  const [yuan, cents = ''] = text.split('.');
  return String(Number(yuan) * 100 + Number(cents.padEnd(2, '0')));
}
