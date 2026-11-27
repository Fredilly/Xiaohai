import { StoreProductImageUploader } from './merchant-image-uploader';
import { useEffect, useState, type FormEvent } from 'react';
import type {
  AdminProductCreateInput,
  StoreCatalogEditRequest,
  StoreCatalogItem,
} from '@xiaohai/contracts/commerce';
import { isValidIsbn, normalizeIsbn } from '@xiaohai/contracts/commerce';
import {
  createStoreDraftProduct,
  listStoreCatalog,
  previewStoreCatalogEdit,
  StoreDraftRejectedError,
  updateStoreCatalog,
} from './store-catalog-api';
import {
  clearStoreDraftRequest,
  pendingStoreDraft,
  reserveStoreDraftRequest,
} from './store-draft-retry';

const limit = 30;

// Keep price parsing lossless and consistent with the HQ editor.
// Invalid, negative, fractional-fen and overflow values never reach the API.
export function parseStorePriceToMinor(value: string): number | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return null;
  const [yuan = '', fraction = ''] = value.split('.');
  const minor = BigInt(yuan) * 100n + BigInt((fraction + '00').slice(0, 2));
  return minor <= 2147483647n ? Number(minor) : null;
}

type StoreCatalogProps = {
  token: string;
  staffAccountId: string;
  storeId: string;
  storeName: string;
};

// A store switch must discard open editors, draft request keys and pending
// image uploads. Shared SKUs can exist at both stores, so retaining an editor
// would otherwise risk applying an old store's values to the new selection.
export function StoreCatalogPanel(props: StoreCatalogProps) {
  return (
    <StoreCatalogSession
      key={`${props.staffAccountId}:${props.token}:${props.storeId}`}
      {...props}
    />
  );
}

function StoreCatalogSession({ token, staffAccountId, storeId, storeName }: StoreCatalogProps) {
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<StoreCatalogItem[]>([]);
  const [more, setMore] = useState(false);
  const [status, setStatus] = useState('正在读取门店商品资料…');
  const [editing, setEditing] = useState<StoreCatalogItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [photoItem, setPhotoItem] = useState<StoreCatalogItem | null>(null);
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
        可编辑本店关联商品的名称、简介、图书资料、SKU
        编码、规格、上架状态、售价及本店陈列信息。若商品资料还影响其他门店，
        系统会拒绝直接修改，避免未经确认覆盖其他门店的共享数据。
      </p>
      <div className="meiping-store-actions">
        <button type="button" onClick={() => setCreating(true)}>
          新增图书 / 普通商品草稿
        </button>
        <small>新商品默认未上架、不可售、库存为 0，须核对资料与库存后显式上架。</small>
      </div>
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
                  <strong>¥{(item.priceMinor / 100).toFixed(2)}</strong>
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
                  {item.productStatus === 'DRAFT' && (
                    <button type="button" onClick={() => setPhotoItem(item)}>
                      上传图片
                    </button>
                  )}
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
      {photoItem && (
        <div className="catalog-editor-overlay" role="presentation">
          <div
            className="catalog-editor-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`上传商品图片：${photoItem.productName}`}
          >
            <StoreProductImageUploader
              key={photoItem.productId}
              token={token}
              storeId={storeId}
              productId={photoItem.productId}
              productVersion={photoItem.productVersion}
              onUploaded={() => {
                setPhotoItem(null);
                setReloadNonce((value) => value + 1);
              }}
              onCancel={() => setPhotoItem(null)}
            />
          </div>
        </div>
      )}
      {creating && (
        <div className="catalog-editor-overlay" role="presentation">
          <div
            className="catalog-editor-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="新增商品草稿"
          >
            <button
              className="catalog-editor-close"
              type="button"
              aria-label="关闭新增商品"
              onClick={() => setCreating(false)}
            >
              ×
            </button>
            <StoreCatalogDraftCreateForm
              token={token}
              staffAccountId={staffAccountId}
              storeId={storeId}
              onCancel={() => setCreating(false)}
              onSaved={() => {
                setCreating(false);
                setOffset(0);
                setReloadNonce((value) => value + 1);
              }}
            />
          </div>
        </div>
      )}
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

export function StoreCatalogDraftCreateForm({
  token,
  staffAccountId,
  storeId,
  onCancel,
  onSaved,
}: {
  token: string;
  staffAccountId: string;
  storeId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<'BOOK' | 'OTHER'>('BOOK');
  const [name, setName] = useState('');
  const [bookTitle, setBookTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [publisher, setPublisher] = useState('');
  const [isbn, setIsbn] = useState('');
  const [skuName, setSkuName] = useState('标准');
  const [skuCode, setSkuCode] = useState('');
  const [priceYuan, setPriceYuan] = useState('');
  const [description, setDescription] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const [status, setStatus] = useState('仅创建未上架草稿，不自动录入真实库存。');

  function restorePending() {
    try {
      const record = pendingStoreDraft(staffAccountId, storeId);
      if (!record) {
        setHasPending(false);
        return;
      }
      const input = record.input;
      setKind(input.book ? 'BOOK' : 'OTHER');
      setName(input.name);
      setBookTitle(input.book?.title ?? '');
      setAuthor(input.book?.author ?? '');
      setPublisher(input.book?.publisher ?? '');
      setIsbn(input.book?.isbn ?? '');
      setSkuName(input.sku.name);
      setSkuCode(input.sku.code ?? '');
      setPriceYuan((input.sku.priceMinor / 100).toFixed(2));
      setDescription(input.description ?? '');
      setCoverUrl(input.coverUrl ?? '');
      setHasPending(true);
      setStatus('已恢复上次未确认的商品草稿，请核对原资料并使用同一请求重试。');
    } catch (error) {
      setHasPending(true);
      setStatus(error instanceof Error ? error.message : '待确认的商品草稿读取失败');
    }
  }

  useEffect(() => {
    restorePending();
    // The component is keyed by staff and store; this only restores on mount.
  }, [staffAccountId, storeId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const priceMinor = parseStorePriceToMinor(priceYuan);
    const productName = kind === 'BOOK' ? bookTitle.trim() : name.trim();
    if (!productName || !skuName.trim() || priceMinor === null) {
      setStatus('请填写商品名称、规格及有效的价格（最多两位小数）。');
      return;
    }
    if (kind === 'BOOK' && (!author.trim() || !bookTitle.trim())) {
      setStatus('图书草稿必须填写书名和作者。');
      return;
    }
    const canonicalIsbn = normalizeIsbn(isbn);
    if (kind === 'BOOK' && canonicalIsbn && !isValidIsbn(canonicalIsbn)) {
      setStatus('ISBN 须为 10 位或 13 位有效格式；没有 ISBN 可以留空。');
      return;
    }
    const cover = coverUrl.trim();
    if (cover) {
      try {
        const url = new URL(cover);
        if (url.protocol !== 'https:' || url.username || url.password) {
          setStatus('商品图片须使用公开可访问的 HTTPS 地址。');
          return;
        }
      } catch {
        setStatus('商品图片须使用有效的 HTTPS 地址。');
        return;
      }
    }
    const input: AdminProductCreateInput = {
      name: productName,
      description: description.trim() || null,
      coverUrl: cover || null,
      status: 'DRAFT',
      book:
        kind === 'BOOK'
          ? {
              title: bookTitle.trim(),
              author: author.trim(),
              publisher: publisher.trim() || null,
              isbn: canonicalIsbn,
            }
          : null,
      sku: {
        ...(skuCode.trim() ? { code: skuCode.trim() } : {}),
        name: skuName.trim(),
        priceMinor,
        status: 'ACTIVE',
        availableForSale: false,
      },
    };
    setSaving(true);
    setStatus('正在创建本店草稿并核对门店关联…');
    let requestKey: string | null = null;
    try {
      const pending = reserveStoreDraftRequest(staffAccountId, storeId, input);
      requestKey = pending.requestKey;
      setHasPending(true);
      await createStoreDraftProduct(token, storeId, pending.input, requestKey);
      clearStoreDraftRequest(staffAccountId, storeId, requestKey);
      setHasPending(false);
      onSaved();
    } catch (error) {
      if (error instanceof StoreDraftRejectedError && requestKey) {
        try {
          clearStoreDraftRequest(staffAccountId, storeId, requestKey);
          setHasPending(false);
        } catch {
          setStatus('本次创建已被拒绝，但本地待确认记录无法清除，请停止重试并核对。');
          return;
        }
      }
      setStatus(
        error instanceof Error ? error.message : '创建结果未确认；原请求已保留，请勿重新建档。',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="catalog-correction-form" onSubmit={(event) => void save(event)}>
      <h3>新增商品草稿</h3>
      <p>可先录入真实商品资料，但默认不会公开上架或产生任何库存数量。</p>
      {hasPending && (
        <div className="meiping-store-actions">
          <strong>存在未确认的草稿创建请求</strong>
          <button type="button" disabled={saving} onClick={restorePending}>
            恢复上次提交内容
          </button>
        </div>
      )}
      <label>
        商品类型
        <select
          value={kind}
          disabled={saving}
          onChange={(e) => setKind(e.target.value as 'BOOK' | 'OTHER')}
        >
          <option value="BOOK">图书</option>
          <option value="OTHER">非图书商品（食品仍须走批次入库）</option>
        </select>
      </label>
      {kind === 'BOOK' ? (
        <>
          <label>
            书名（同时作为商品名称）
            <input
              required
              maxLength={160}
              value={bookTitle}
              onChange={(e) => setBookTitle(e.target.value)}
            />
          </label>
          <label>
            作者
            <input
              required
              maxLength={160}
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </label>
          <label>
            出版社（可留空）
            <input
              maxLength={160}
              value={publisher}
              onChange={(e) => setPublisher(e.target.value)}
            />
          </label>
          <label>
            ISBN（可留空；有值时校验格式和全库去重）
            <input maxLength={32} value={isbn} onChange={(e) => setIsbn(e.target.value)} />
          </label>
        </>
      ) : (
        <label>
          商品名称
          <input required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      )}
      <label>
        商品规格 / SKU 名称
        <input
          required
          maxLength={120}
          value={skuName}
          onChange={(e) => setSkuName(e.target.value)}
        />
      </label>
      <label>
        SKU 编码（可留空自动生成）
        <input maxLength={80} value={skuCode} onChange={(e) => setSkuCode(e.target.value)} />
      </label>
      <label>
        售价（元）
        <input
          required
          inputMode="decimal"
          value={priceYuan}
          onChange={(e) => setPriceYuan(e.target.value)}
        />
      </label>
      <label>
        商品简介
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label>
        商品封面 HTTPS URL（也可先保存草稿，再用图片管理上传）
        <input type="url" value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} />
      </label>
      <p className="dashboard-status" role="status">
        {status}
      </p>
      <div className="meiping-store-actions">
        <button type="submit" disabled={saving}>
          {saving ? '保存草稿中…' : '保存草稿'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving}>
          取消
        </button>
      </div>
    </form>
  );
}

function draftFor(item: StoreCatalogItem): StoreCatalogEditRequest {
  return {
    expectedProductVersion: item.productVersion,
    expectedSkuVersion: item.skuVersion,
    expectedLocalVersion: item.localVersion,
    shelfLocation: item.shelfLocation,
    storeNote: item.storeNote,
    displayInfo: item.displayInfo,
  };
}

type StoreBookFields = { title: string; author: string; publisher: string; isbn: string };

/** Book/edition versions are sent only for changed fields, never for non-book SKUs. */
export function changedStoreBookFields(
  item: StoreCatalogItem,
  fields: StoreBookFields,
): Partial<StoreCatalogEditRequest> {
  if (item.bookTitle === null) return {};
  const title = fields.title.trim();
  const author = fields.author.trim();
  const publisher = fields.publisher.trim() || null;
  const isbn = normalizeIsbn(fields.isbn);
  if (!title || !author) throw new Error('请填写非空的书名和作者。');
  if (isbn !== normalizeIsbn(item.isbn) && !isValidIsbn(isbn)) {
    throw new Error('变更 ISBN 需要提供 10 位或 13 位有效格式，不能直接清空已有 ISBN。');
  }
  const bookChanged = title !== item.bookTitle || author !== item.author;
  const editionChanged = publisher !== item.publisher || isbn !== normalizeIsbn(item.isbn);
  return {
    ...(bookChanged ? { expectedBookVersion: item.bookVersion } : {}),
    ...(editionChanged ? { expectedEditionVersion: item.editionVersion } : {}),
    ...(title !== item.bookTitle ? { bookTitle: title } : {}),
    ...(author !== item.author ? { author } : {}),
    ...(publisher !== item.publisher ? { publisher } : {}),
    ...(isbn !== normalizeIsbn(item.isbn) ? { isbn } : {}),
  };
}

export function StoreCatalogEditForm({
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
  const [draft, setDraft] = useState(() => draftFor(item));
  const [name, setName] = useState(item.productName);
  const [bookTitle, setBookTitle] = useState(item.bookTitle ?? '');
  const [author, setAuthor] = useState(item.author ?? '');
  const [publisher, setPublisher] = useState(item.publisher ?? '');
  const [isbn, setIsbn] = useState(item.isbn ?? '');
  const [description, setDescription] = useState(item.description ?? '');
  const [skuCode, setSkuCode] = useState(item.skuCode);
  const [skuName, setSkuName] = useState(item.skuName);
  const [productStatusValue, setProductStatusValue] = useState(item.productStatus);
  const [skuStatusValue, setSkuStatusValue] = useState(item.skuStatus);
  const [availableForSale, setAvailableForSale] = useState(item.availableForSale);
  const [publicationConfirmed, setPublicationConfirmed] = useState(false);
  const [priceYuan, setPriceYuan] = useState(() => (item.priceMinor / 100).toFixed(2));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(
    '本店独立商品可修改名称和价格；跨店共享商品需先明确跨店编辑规则。',
  );

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const priceMinor = parseStorePriceToMinor(priceYuan);
    if (priceMinor === null || !name.trim() || !skuCode.trim() || !skuName.trim()) {
      setStatus('请填写有效的商品名称、SKU 编码、规格及价格（最多两位小数）。');
      return;
    }
    const publicationChanged =
      productStatusValue !== item.productStatus ||
      skuStatusValue !== item.skuStatus ||
      availableForSale !== item.availableForSale;
    if (publicationChanged && !publicationConfirmed) {
      setStatus('上下架或可售状态变更前，须确认已经核对商品资料、图片与库存。');
      return;
    }
    let bookFields: Partial<StoreCatalogEditRequest>;
    try {
      bookFields = changedStoreBookFields(item, { title: bookTitle, author, publisher, isbn });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '图书资料无效');
      return;
    }
    const input: StoreCatalogEditRequest = {
      ...draft,
      ...bookFields,
      ...(name.trim() !== item.productName ? { productName: name.trim() } : {}),
      ...(description.trim() !== (item.description ?? '')
        ? { description: description.trim() || null }
        : {}),
      ...(productStatusValue !== item.productStatus ? { productStatus: productStatusValue } : {}),
      ...(skuCode.trim() !== item.skuCode ? { skuCode: skuCode.trim() } : {}),
      ...(skuName.trim() !== item.skuName ? { skuName: skuName.trim() } : {}),
      ...(skuStatusValue !== item.skuStatus ? { skuStatus: skuStatusValue } : {}),
      ...(availableForSale !== item.availableForSale ? { availableForSale } : {}),
      ...(priceMinor !== item.priceMinor ? { priceMinor } : {}),
    };
    const editsShared =
      input.productName !== undefined ||
      input.description !== undefined ||
      input.productStatus !== undefined ||
      input.skuCode !== undefined ||
      input.skuName !== undefined ||
      input.skuStatus !== undefined ||
      input.availableForSale !== undefined ||
      input.bookTitle !== undefined ||
      input.author !== undefined ||
      input.publisher !== undefined ||
      input.isbn !== undefined;
    setSaving(true);
    setStatus(editsShared ? '正在核对商品对其他门店的影响…' : '正在保存本店资料…');
    try {
      const preview = editsShared
        ? await previewStoreCatalogEdit(token, storeId, item.skuId, input)
        : null;
      if (editsShared && !preview?.previewToken) {
        throw new Error('商品变更未获得有效的影响确认，请重新加载。');
      }
      await updateStoreCatalog(
        token,
        storeId,
        item.skuId,
        input,
        preview?.previewToken ?? undefined,
      );
      onSaved();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
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
        onChange={(event) =>
          setDraft((current) => ({ ...current, [key]: event.target.value || null }))
        }
      />
    </label>
  );

  return (
    <form className="catalog-correction-form" onSubmit={(event) => void save(event)}>
      <h3>编辑商品资料：{item.bookTitle ?? item.productName}</h3>
      <p>
        名称、简介、图书资料、SKU
        编码、规格和上下架状态是共享资料，变更需核对影响范围；若涉及其他门店则拒绝本店直接修改。售价只修改当前门店。
      </p>
      <label>
        商品名称
        <input
          required
          maxLength={160}
          value={name}
          disabled={saving}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        商品简介（最多 4000 字）
        <textarea
          maxLength={4000}
          value={description}
          disabled={saving}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      {item.bookTitle !== null && (
        <>
          <label>
            书名
            <input
              required
              maxLength={200}
              value={bookTitle}
              disabled={saving}
              onChange={(event) => setBookTitle(event.target.value)}
            />
          </label>
          <label>
            作者
            <input
              required
              maxLength={160}
              value={author}
              disabled={saving}
              onChange={(event) => setAuthor(event.target.value)}
            />
          </label>
          <label>
            出版社
            <input
              maxLength={160}
              value={publisher}
              disabled={saving}
              onChange={(event) => setPublisher(event.target.value)}
            />
          </label>
          <label>
            ISBN（不可直接清空已存在的 ISBN）
            <input
              maxLength={32}
              value={isbn}
              disabled={saving}
              onChange={(event) => setIsbn(event.target.value)}
            />
          </label>
        </>
      )}
      <label>
        SKU 编码 / 条码
        <input
          required
          maxLength={80}
          value={skuCode}
          disabled={saving}
          onChange={(event) => setSkuCode(event.target.value)}
        />
      </label>
      <label>
        商品规格 / SKU 名称
        <input
          required
          maxLength={120}
          value={skuName}
          disabled={saving}
          onChange={(event) => setSkuName(event.target.value)}
        />
      </label>
      <label>
        商品状态
        <select
          disabled={saving}
          value={productStatusValue}
          onChange={(event) => {
            const value = event.target.value as StoreCatalogItem['productStatus'];
            setProductStatusValue(value);
            if (value !== 'ACTIVE') setAvailableForSale(false);
            setPublicationConfirmed(false);
          }}
        >
          <option value="DRAFT">草稿（不展示）</option>
          <option value="ACTIVE">已上架（可展示）</option>
          <option value="INACTIVE">已停用（不展示）</option>
        </select>
      </label>
      <label>
        SKU 状态
        <select
          disabled={saving}
          value={skuStatusValue}
          onChange={(event) => {
            const value = event.target.value as StoreCatalogItem['skuStatus'];
            setSkuStatusValue(value);
            if (value !== 'ACTIVE') setAvailableForSale(false);
            setPublicationConfirmed(false);
          }}
        >
          <option value="ACTIVE">有效</option>
          <option value="INACTIVE">停用</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          disabled={saving || productStatusValue !== 'ACTIVE' || skuStatusValue !== 'ACTIVE'}
          checked={availableForSale}
          onChange={(event) => {
            setAvailableForSale(event.target.checked);
            setPublicationConfirmed(false);
          }}
        />
        允许销售（仍受真实库存、食品安全开关和结算门禁限制）
      </label>
      <label>
        <input
          type="checkbox"
          disabled={saving}
          checked={publicationConfirmed}
          onChange={(event) => setPublicationConfirmed(event.target.checked)}
        />
        我已核对商品资料、图片及库存，确认本次上下架或可售状态变更
      </label>
      <label>
        售价（元）
        <input
          required
          inputMode="decimal"
          value={priceYuan}
          disabled={saving}
          onChange={(event) => setPriceYuan(event.target.value)}
        />
      </label>
      {textField('货架位置', 'shelfLocation', item.shelfLocation)}
      {textField('本店备注', 'storeNote', item.storeNote)}
      {textField('陈列信息', 'displayInfo', item.displayInfo)}
      <p className="dashboard-status" role="status">
        {status}
      </p>
      <div className="meiping-store-actions">
        <button type="submit" disabled={saving}>
          {saving ? '核对并保存中…' : '保存商品资料'}
        </button>
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
