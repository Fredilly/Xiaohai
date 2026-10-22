import { useEffect, useState, type FormEvent } from 'react';
import type { StoreCatalogEditRequest, StoreCatalogItem } from '@xiaohai/contracts/commerce';
import { listStoreCatalog, previewStoreCatalogEdit, updateStoreCatalog } from './store-catalog-api';

const limit = 30;
const maxMoneyMinor = 2_147_483_647n;

export function yuanToMinor(value: string): number | null {
  const text = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [yuan, cents] = text.split('.');
  if (yuan === undefined) return null;
  const minor = BigInt(yuan) * 100n + BigInt((cents ?? '').padEnd(2, '0'));
  return minor > maxMoneyMinor ? null : Number(minor);
}

export function formatYuan(priceMinor: number): string {
  return `¥${(priceMinor / 100).toFixed(2)}`;
}

export function sharedImpactConfirmation(
  originalPriceMinor: number,
  nextPriceMinor: number,
  affectedStoreCount: number,
): string {
  return `共享价格：${formatYuan(originalPriceMinor)} → ${formatYuan(nextPriceMinor)}；将影响 ${affectedStoreCount} 家门店，确认保存？`;
}

export function StoreCatalogPanel({
  token,
  storeId,
  storeName,
}: {
  token: string;
  storeId: string;
  storeName: string;
}) {
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<StoreCatalogItem[]>([]);
  const [more, setMore] = useState(false);
  const [status, setStatus] = useState('正在读取门店商品资料…');
  const [editing, setEditing] = useState<StoreCatalogItem | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setItems([]);
    setStatus('正在读取门店商品资料…');
    void listStoreCatalog(token, storeId, { q: applied, offset, limit })
      .then((page) => {
        if (!active) return;
        if (page.storeId !== storeId) throw new Error('门店商品资料上下文不一致');
        setItems(page.items);
        setMore(page.hasMore);
        setStatus(
          page.items.length ? '展示本店已建立库存记录的商品资料' : '本店暂无关联库存的正式商品资料',
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        setItems([]);
        setMore(false);
        setStatus(error instanceof Error ? error.message : '读取商品资料失败');
      });
    return () => {
      active = false;
    };
  }, [token, storeId, applied, offset, reloadNonce]);

  useEffect(() => {
    if (!editing) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setEditing(null);
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [editing]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setApplied(query.trim());
  }

  return (
    <section className="panel store-catalog-panel">
      <span className="tag">日常商品资料 · 店铺账号可编辑</span>
      <h2>本店商品资料</h2>
      <p>
        当前门店：{storeName}
        。仅显示与本店库存记录关联的商品及其基础资料。库存数量仍须通过库存盘点或调整流程变更。
      </p>
      <p>
        书名、作者、出版社、ISBN 及 SKU
        价格可能被多家门店共用。保存共享资料前，系统会显示影响门店范围并要求确认；历史商品纠错记录仍可单独查看。
      </p>
      <form className="book-search-form" onSubmit={search}>
        <input
          aria-label="搜索本店商品资料"
          maxLength={120}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="书名、作者、ISBN、出版社、SKU"
        />
        <button>搜索本店商品</button>
      </form>
      <div className="data-table-scroll" role="region" aria-label="本店商品资料表格" tabIndex={0}>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">商品 / SKU</th>
              <th scope="col">作者 / 出版社</th>
              <th scope="col">ISBN</th>
              <th scope="col" className="numeric">
                售价
              </th>
              <th scope="col" className="numeric">
                现存 / 可用
              </th>
              <th scope="col" className="numeric">
                占用
              </th>
              <th scope="col">商品 / SKU 状态</th>
              <th scope="col" className="numeric">
                库存版本
              </th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.storeId + ':' + item.skuId}>
                <td>
                  <strong className="cell-title">{item.bookTitle || item.productName}</strong>
                  <small className="cell-meta">{item.skuCode}</small>
                </td>
                <td>
                  <span>{item.author || '未填写'}</span>
                  <small className="cell-meta">{item.publisher || '未填写'}</small>
                </td>
                <td className="cell-code">{item.isbn || '—'}</td>
                <td className="numeric">
                  <strong>{formatYuan(item.priceMinor)}</strong>
                  <small className="cell-meta">{item.availableForSale ? '可售' : '不可售'}</small>
                </td>
                <td className="numeric">
                  <strong>
                    {item.onHand} / {item.available}
                  </strong>
                </td>
                <td className="numeric">{item.reserved + item.rentalReserved}</td>
                <td>
                  <span className="status-pill">{productStatus(item.productStatus)}</span>
                  <small className="cell-meta">SKU：{skuStatus(item.skuStatus)}</small>
                </td>
                <td className="numeric">v{item.inventoryVersion}</td>
                <td>
                  <button type="button" onClick={() => setEditing(item)}>
                    编辑商品资料
                  </button>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={9} className="data-table-empty">
                  暂无符合条件的商品
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="meiping-store-actions">
        <button disabled={offset === 0} onClick={() => setOffset((n) => Math.max(0, n - limit))}>
          上一页
        </button>
        <span>第 {Math.floor(offset / limit) + 1} 页</span>
        <button disabled={!more} onClick={() => setOffset((n) => n + limit)}>
          下一页
        </button>
      </div>
      <p role="status">{status}</p>
      {editing && (
        <div
          className="catalog-editor-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditing(null);
          }}
        >
          <div
            className="catalog-editor-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`编辑商品资料：${editing.bookTitle ?? editing.productName}`}
          >
            <button
              className="catalog-editor-close"
              type="button"
              aria-label="关闭商品编辑"
              onClick={() => setEditing(null)}
            >
              ×
            </button>
            <StoreCatalogEditForm
              key={editing.skuId}
              token={token}
              storeId={storeId}
              item={editing}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                setReloadNonce((value) => value + 1);
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function draftFor(item: StoreCatalogItem): StoreCatalogEditRequest {
  return {
    expectedProductVersion: item.productVersion,
    expectedBookVersion: item.bookTitle === null ? undefined : item.bookVersion,
    expectedEditionVersion: item.bookTitle === null ? undefined : item.editionVersion,
    expectedSkuVersion: item.skuVersion,
    expectedLocalVersion: item.localVersion,
    productName: item.productName,
    ...(item.bookTitle === null
      ? {}
      : {
          bookTitle: item.bookTitle,
          author: item.author ?? '',
          publisher: item.publisher,
          isbn: item.isbn,
        }),
    priceMinor: item.priceMinor,
    shelfLocation: item.shelfLocation,
    storeNote: item.storeNote,
    displayInfo: item.displayInfo,
  };
}

function StoreCatalogEditForm({
  token,
  storeId,
  item,
  onCancel,
  onSaved,
}: {
  token: string;
  storeId: string;
  item: StoreCatalogItem;
  onCancel: () => void;
  onSaved: () => void;
}) {
  type NormalizedEditRequest = Omit<StoreCatalogEditRequest, 'priceMinor'> & {
    priceMinor: number;
  };
  const [draft, setDraft] = useState(() => draftFor(item));
  const [impact, setImpact] = useState<
    Awaited<ReturnType<typeof previewStoreCatalogEdit>>['impact'] | null
  >(null);
  const [priceYuan, setPriceYuan] = useState(() => (item.priceMinor / 100).toFixed(2));
  const [status, setStatus] = useState('请核对原值和新值。');
  const sharedKeys = [
    'productName',
    'bookTitle',
    'author',
    'publisher',
    'isbn',
    'priceMinor',
  ] as const;
  const hasSharedChanges = sharedKeys.some((key) => {
    const original =
      key === 'productName'
        ? item.productName
        : key === 'bookTitle'
          ? item.bookTitle
          : key === 'author'
            ? item.author
            : key === 'publisher'
              ? item.publisher
              : key === 'isbn'
                ? item.isbn
                : item.priceMinor;
    if (key === 'priceMinor') {
      const parsedPrice = yuanToMinor(priceYuan);
      return parsedPrice === null || parsedPrice !== original;
    }
    return draft[key] !== original;
  });

  function setDraftField<Key extends keyof StoreCatalogEditRequest>(
    key: Key,
    value: StoreCatalogEditRequest[Key],
  ) {
    setImpact(null);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function normalizedDraft(): NormalizedEditRequest | null {
    const parsedPrice = yuanToMinor(priceYuan);
    if (parsedPrice === null) return null;
    return { ...draft, priceMinor: parsedPrice };
  }

  async function calculateImpact() {
    const nextDraft = normalizedDraft();
    if (!nextDraft) {
      setStatus('价格请填写非负元金额，最多两位小数，且不得超过系统上限。');
      return;
    }
    setStatus('正在计算影响门店…');
    try {
      const result = await previewStoreCatalogEdit(token, storeId, item.skuId, nextDraft);
      setImpact(result.impact);
      setStatus(`预计影响 ${result.impact.affectedStoreCount} 家门店。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '影响范围计算失败');
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextDraft = normalizedDraft();
    if (!nextDraft) {
      setStatus('价格请填写非负元金额，最多两位小数，且不得超过系统上限。');
      return;
    }
    if (hasSharedChanges && !impact) {
      setStatus('请先计算共享资料影响范围。');
      return;
    }
    if (
      hasSharedChanges &&
      !window.confirm(
        sharedImpactConfirmation(
          item.priceMinor,
          nextDraft.priceMinor,
          impact?.affectedStoreCount ?? 0,
        ),
      )
    )
      return;
    setStatus('正在保存…');
    try {
      await updateStoreCatalog(token, storeId, item.skuId, nextDraft);
      onSaved();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存失败');
    }
  }

  const textField = (
    label: string,
    key: keyof StoreCatalogEditRequest,
    original: string | null,
  ) => (
    <label>
      {label}（原值：{original ?? '未填写'}）
      <input
        value={typeof draft[key] === 'string' ? draft[key] : ''}
        onChange={(event) => setDraftField(key, event.target.value || null)}
      />
    </label>
  );

  return (
    <form className="catalog-correction-form" onSubmit={(event) => void save(event)}>
      <h3>编辑商品资料：{item.bookTitle ?? item.productName}</h3>
      {textField('商品名称', 'productName', item.productName)}
      {item.bookTitle !== null && (
        <>
          {textField('书名', 'bookTitle', item.bookTitle)}
          {textField('作者', 'author', item.author)}
          {textField('出版社', 'publisher', item.publisher)}
          {textField('ISBN', 'isbn', item.isbn)}
        </>
      )}
      <label>
        SKU 价格（元，原值：{formatYuan(item.priceMinor)}）
        <input
          type="text"
          inputMode="decimal"
          min="0"
          aria-label="SKU 价格（元）"
          value={priceYuan}
          onChange={(event) => {
            setImpact(null);
            setPriceYuan(event.target.value);
          }}
        />
      </label>
      {textField('货架位置', 'shelfLocation', item.shelfLocation)}
      {textField('本店备注', 'storeNote', item.storeNote)}
      {textField('陈列信息', 'displayInfo', item.displayInfo)}
      <p className="dashboard-status" role="status">
        {status}
      </p>
      <div className="meiping-store-actions">
        {hasSharedChanges && (
          <button type="button" onClick={() => void calculateImpact()}>
            计算共享影响范围
          </button>
        )}
        <button type="submit">保存正式商品资料</button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}

export function productStatus(status: StoreCatalogItem['productStatus']): string {
  return { DRAFT: '草稿', ACTIVE: '已上架', INACTIVE: '已停用' }[status];
}
export function skuStatus(status: StoreCatalogItem['skuStatus']): string {
  return { ACTIVE: '有效', INACTIVE: '已停用' }[status];
}
