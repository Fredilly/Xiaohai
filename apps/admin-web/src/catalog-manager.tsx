import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  adminProductUpdateInputSchema,
  type AdminProductInput,
  type AdminProductCreateInput,
  type AdminProductUpdateInput,
  type StoreCatalogEditRequest,
  type StoreCatalogItem,
} from '@xiaohai/contracts/commerce';
import type { StaffStore } from '@xiaohai/contracts/stores';
import { displayStatus, money } from './display';
import {
  CatalogApiError,
  createAdminProduct,
  getAdminProduct,
  lookupBook as lookupBookData,
  listAdminProducts,
  updateAdminProduct,
  previewAdminProductUpdate,
  listHqStoreCatalog,
  previewHqStoreCatalogEdit,
  updateHqStoreCatalog,
} from './catalog-api';
import { loadHqStores } from './hq-operations-api';
import { isValidIsbn, normalizeIsbn } from '@xiaohai/contracts/commerce';
import { createBookLookupGate } from './book-lookup-gate';
type Product = Awaited<ReturnType<typeof listAdminProducts>>['products'][number];
export function parseYuanToMinor(value: string): number | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return null;
  const [yuan = '', fraction = ''] = value.split('.');
  const minor = BigInt(yuan) * 100n + BigInt((fraction + '00').slice(0, 2));
  return minor <= 2147483647n ? Number(minor) : null;
}
const blank: AdminProductInput = {
  name: '',
  description: null,
  coverUrl: null,
  status: 'DRAFT',
  book: { title: '', author: '', isbn: null, publisher: null },
  sku: { code: '', name: '标准', priceMinor: 0, status: 'ACTIVE', availableForSale: false },
};
export function CatalogManager({ token }: { token: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [state, setState] = useState('loading');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (!creating && !editing) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setCreating(false);
        setEditing(null);
      }
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [creating, editing]);

  async function load() {
    setState('loading');
    try {
      const page = await listAdminProducts(token, q, offset, 30);
      setProducts(page.products);
      setHasMore(page.hasMore);
      setState('ready');
    } catch (e) {
      setState(
        e instanceof CatalogApiError && e.status === 403
          ? 'forbidden'
          : e instanceof CatalogApiError && e.status === 401
            ? 'unauthorized'
            : 'error',
      );
    }
  }
  useEffect(() => {
    void load();
  }, [token, offset]);
  if (state === 'forbidden') return <section className="panel">当前账号没有商品管理权限。</section>;
  if (state === 'unauthorized')
    return <section className="panel">登录状态已失效，请重新登录。</section>;
  return (
    <section className="panel">
      <h2>图书与商品</h2>
      <div className="section-toolbar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索商品" />
        <button
          onClick={() => {
            setOffset(0);
            if (offset === 0) void load();
          }}
        >
          搜索
        </button>
        <button onClick={() => setCreating(true)}>新增商品</button>
      </div>
      {state === 'loading' ? (
        <p>加载中…</p>
      ) : state === 'error' ? (
        <button onClick={() => void load()}>加载失败，重试</button>
      ) : products.length === 0 ? (
        <p>暂无商品</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>商品</th>
                <th>书名 / 作者</th>
                <th>SKU 编码</th>
                <th>价格</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.skuId}>
                  <td className="product-cell">
                    {p.coverUrl ? (
                      <img src={p.coverUrl} alt="" />
                    ) : (
                      <span className="product-cover-empty">图书</span>
                    )}
                    <strong>{p.name}</strong>
                  </td>
                  <td>
                    {p.book?.title ?? '—'}
                    <br />
                    <small>{p.book?.author ?? '—'}</small>
                  </td>
                  <td>{p.sku.code}</td>
                  <td>{money(p.sku.priceMinor)}</td>
                  <td>
                    <span className="badge">
                      {displayStatus(p.status)} · {p.sku.availableForSale ? '可售' : '停售'}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => setEditing(p)}>编辑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pagination" aria-label="总部商品分页">
        <button
          disabled={offset === 0 || state === 'loading'}
          onClick={() => setOffset(Math.max(0, offset - 30))}
        >
          上一页
        </button>
        <span>第 {Math.floor(offset / 30) + 1} 页 · 每页 30 种商品（展示全部 SKU）</span>
        <button disabled={!hasMore || state === 'loading'} onClick={() => setOffset(offset + 30)}>
          下一页
        </button>
      </div>
      {(creating || editing) && (
        <div
          className="catalog-editor-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setCreating(false);
              setEditing(null);
            }
          }}
        >
          <div
            className="catalog-editor-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={editing ? '总部编辑商品' : '总部新增商品'}
          >
            <button
              className="catalog-editor-close"
              type="button"
              aria-label="关闭总部商品表单"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              ×
            </button>
            <ProductForm
              key={editing?.skuId ?? 'new-product'}
              initial={editing ?? blank}
              token={token}
              onOpenExisting={async (productId) => {
                const existing = await getAdminProduct(token, productId);
                setCreating(false);
                setEditing(existing);
              }}
              onCancel={() => {
                setCreating(false);
                setEditing(null);
              }}
              onReload={() => {
                setCreating(false);
                setEditing(null);
                void load();
              }}
              onSave={async (input, requestKey) => {
                if (editing) {
                  const updateInput = adminProductUpdateInputSchema.parse(input);
                  const preview = await previewAdminProductUpdate(token, editing.id, updateInput);
                  if (
                    !window.confirm(
                      `总部修改将影响 ${preview.impact.affectedStoreCount} 家门店。确认正式保存？`,
                    )
                  )
                    return;
                  await updateAdminProduct(token, editing.id, updateInput, preview.previewToken);
                } else {
                  await createAdminProduct(token, input, requestKey);
                }
                setCreating(false);
                setEditing(null);
                await load();
              }}
            />
          </div>
        </div>
      )}
      <HqStoreCatalogEditor token={token} />
    </section>
  );
}

function HqStoreCatalogEditor({ token }: { token: string }) {
  const [stores, setStores] = useState<StaffStore[]>([]);
  const [storeId, setStoreId] = useState('');
  const [items, setItems] = useState<StoreCatalogItem[]>([]);
  const [editing, setEditing] = useState<StoreCatalogItem | null>(null);
  const [status, setStatus] = useState('加载总部可管理门店…');
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    void loadHqStores(token)
      .then((result) => {
        setStores(result.stores);
        setStoreId((current) => current || result.stores[0]?.id || '');
      })
      .catch(() => setStatus('无法读取总部门店范围'));
  }, [token]);

  useEffect(() => {
    if (!editing) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setEditing(null);
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [editing]);

  useEffect(() => {
    if (!storeId) return;
    setStatus('加载门店商品资料…');
    void listHqStoreCatalog(token, storeId)
      .then((result) => {
        setItems(result.items);
        setStatus(
          result.hasMore ? '仅显示前 30 条，请使用门店端分页继续查看' : '已加载当前门店商品资料',
        );
      })
      .catch(() => {
        setItems([]);
        setStatus('无法读取门店商品资料');
      });
  }, [token, storeId, reloadNonce]);

  async function openLatest(item: StoreCatalogItem) {
    setStatus('正在读取商品最新版本…');
    try {
      const result = await listHqStoreCatalog(token, storeId);
      const current = result.items.find((candidate) => candidate.skuId === item.skuId);
      if (!current) {
        setStatus('商品已不在当前门店列表中，请重新加载。');
        return;
      }
      setItems(result.items);
      setEditing(current);
      setStatus('已读取商品最新版本，可开始编辑。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '读取最新资料失败');
    }
  }

  return (
    <section className="panel">
      <h2>总部跨门店商品资料</h2>
      <p className="muted">
        总部可编辑共享商品资料及指定门店的货架、备注和陈列信息。保存共享字段前会显示影响范围。
      </p>
      <label>
        管理门店
        <select
          value={storeId}
          onChange={(event) => {
            setStoreId(event.target.value);
            setEditing(null);
          }}
        >
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
      </label>
      {status && <p role="status">{status}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>商品</th>
              <th>ISBN / SKU</th>
              <th>价格</th>
              <th>本店备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.skuId}>
                <td>{item.bookTitle ?? item.productName}</td>
                <td>
                  {item.isbn ?? '—'} / {item.skuCode}
                </td>
                <td>¥{(item.priceMinor / 100).toFixed(2)}</td>
                <td>{item.storeNote ?? '—'}</td>
                <td>
                  <button type="button" onClick={() => void openLatest(item)}>
                    编辑
                  </button>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={5}>当前门店暂无库存关联商品</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
            aria-label={`总部编辑商品：${editing.bookTitle ?? editing.productName}`}
          >
            <button
              className="catalog-editor-close"
              type="button"
              aria-label="关闭总部商品编辑"
              onClick={() => setEditing(null)}
            >
              ×
            </button>
            <HqStoreCatalogForm
              key={editing.skuId}
              token={token}
              storeId={storeId}
              item={editing}
              onCancel={() => setEditing(null)}
              onReload={() => {
                setEditing(null);
                setReloadNonce((value) => value + 1);
              }}
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

function HqStoreCatalogForm({
  token,
  storeId,
  item,
  onCancel,
  onReload,
  onSaved,
}: {
  token: string;
  storeId: string;
  item: StoreCatalogItem;
  onCancel: () => void;
  onReload: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<StoreCatalogEditRequest>({
    expectedProductVersion: item.productVersion,
    expectedBookVersion: item.bookTitle ? item.bookVersion : undefined,
    expectedEditionVersion: item.bookTitle ? item.editionVersion : undefined,
    expectedSkuVersion: item.skuVersion,
    expectedLocalVersion: item.localVersion,
    productName: item.productName,
    bookTitle: item.bookTitle ?? undefined,
    author: item.author ?? undefined,
    publisher: item.publisher,
    isbn: item.isbn,
    priceMinor: item.priceMinor,
    shelfLocation: item.shelfLocation,
    storeNote: item.storeNote,
    displayInfo: item.displayInfo,
  });
  const [status, setStatus] = useState('请核对原值和新值');
  const [stale, setStale] = useState(false);
  const setText = (key: keyof StoreCatalogEditRequest, value: string) =>
    setDraft((current) => ({ ...current, [key]: value || null }));

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const impact = await previewHqStoreCatalogEdit(token, storeId, item.skuId, draft);
      if (
        impact.impact.sharedFields.length &&
        !window.confirm(`共享资料将影响 ${impact.impact.affectedStoreCount} 家门店，确认保存？`)
      )
        return;
      if (impact.impact.sharedFields.length && !impact.previewToken) {
        throw new Error('总部共享资料修改缺少服务端预览凭证');
      }
      await updateHqStoreCatalog(token, storeId, item.skuId, draft, impact.previewToken);
      onSaved();
    } catch (error) {
      if (error instanceof CatalogApiError && error.status === 409) {
        setStale(true);
        setStatus('保存冲突：商品资料已被其他账号修改，请重新加载最新版本后再编辑。');
      } else {
        setStatus(error instanceof Error ? error.message : '保存失败，请检查网络及权限。');
      }
    }
  }

  return (
    <form className="cms-form" onSubmit={(event) => void save(event)}>
      <h3>总部编辑：{item.bookTitle ?? item.productName}</h3>
      <label>
        商品名称
        <input
          value={draft.productName ?? ''}
          onChange={(event) => setText('productName', event.target.value)}
        />
      </label>
      {item.bookTitle && (
        <>
          <label>
            书名
            <input
              value={draft.bookTitle ?? ''}
              onChange={(event) => setText('bookTitle', event.target.value)}
            />
          </label>
          <label>
            作者
            <input
              value={draft.author ?? ''}
              onChange={(event) => setText('author', event.target.value)}
            />
          </label>
          <label>
            出版社
            <input
              value={draft.publisher ?? ''}
              onChange={(event) => setText('publisher', event.target.value)}
            />
          </label>
          <label>
            ISBN
            <input
              value={draft.isbn ?? ''}
              onChange={(event) => setText('isbn', event.target.value)}
            />
          </label>
        </>
      )}
      <label>
        价格（分）
        <input
          type="number"
          min="0"
          max="2147483647"
          value={draft.priceMinor ?? item.priceMinor}
          onChange={(event) =>
            setDraft((current) => ({ ...current, priceMinor: Number(event.target.value) }))
          }
        />
      </label>
      <label>
        本店货架位置
        <input
          value={draft.shelfLocation ?? ''}
          onChange={(event) => setText('shelfLocation', event.target.value)}
        />
      </label>
      <label>
        本店备注
        <textarea
          value={draft.storeNote ?? ''}
          onChange={(event) => setText('storeNote', event.target.value)}
        />
      </label>
      <p role="status">{status}</p>
      {stale && (
        <button type="button" onClick={onReload}>
          放弃本次编辑，重新加载最新资料
        </button>
      )}
      <button type="submit" disabled={stale}>
        保存正式资料
      </button>{' '}
      <button type="button" onClick={onCancel}>
        取消
      </button>
    </form>
  );
}
function ProductForm({
  initial,
  token,
  onOpenExisting,
  onCancel,
  onReload,
  onSave,
}: {
  initial: Product | AdminProductInput;
  token: string;
  onOpenExisting: (productId: string) => Promise<void>;
  onCancel: () => void;
  onReload: () => void;
  onSave: (
    input: AdminProductCreateInput | AdminProductUpdateInput,
    requestKey: string,
  ) => Promise<void>;
}) {
  const [requestKey] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const editingExisting = 'productVersion' in initial;
  const [v, setV] = useState<AdminProductInput>({
    name: initial.name,
    description: initial.description,
    coverUrl: initial.coverUrl,
    status: initial.status,
    book: initial.book,
    sku: initial.sku,
    ...('productVersion' in initial
      ? {
          expectedProductVersion: initial.productVersion,
          expectedSkuId: initial.skuId,
          ...(initial.bookVersion === null ? {} : { expectedBookVersion: initial.bookVersion }),
          ...(initial.editionVersion === null
            ? {}
            : { expectedEditionVersion: initial.editionVersion }),
          expectedSkuVersion: initial.skuVersion,
        }
      : {}),
  });
  const [isBook, setIsBook] = useState(initial.book !== null);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [priceYuan, setPriceYuan] = useState(() => (v.sku.priceMinor / 100).toFixed(2));
  const [lookupStatus, setLookupStatus] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [existingProductId, setExistingProductId] = useState<string | null>(null);
  const [existingBook, setExistingBook] = useState(false);
  // Every manual edit invalidates older pending ISBN lookup results.
  const lookupSequence = useRef(createBookLookupGate());
  useEffect(
    () => () => {
      lookupSequence.current.invalidate();
    },
    [],
  );
  function invalidateLookup() {
    lookupSequence.current.invalidate();
    setLookingUp(false);
  }

  function updateBook(field: 'title' | 'author' | 'isbn' | 'publisher', value: string) {
    invalidateLookup();
    setV((current) => ({
      ...current,
      name: !editingExisting && field === 'title' ? value : current.name,
      book: {
        title: field === 'title' ? value : (current.book?.title ?? ''),
        author: field === 'author' ? value : (current.book?.author ?? ''),
        isbn: field === 'isbn' ? value || null : (current.book?.isbn ?? null),
        publisher: field === 'publisher' ? value || null : (current.book?.publisher ?? null),
      },
    }));
    if (field === 'isbn') {
      setLookupStatus('');
      setExistingProductId(null);
      setExistingBook(false);
    }
  }

  async function lookupBook() {
    const request = lookupSequence.current.start();
    const raw = v.book?.isbn ?? '';
    const isbn = normalizeIsbn(raw);
    setLookingUp(false);
    if (!isbn) {
      setLookupStatus('请输入图书编码后再检索。');
      return;
    }
    if (!isValidIsbn(isbn)) {
      setLookupStatus('图书编码格式不正确，请检查 ISBN / 图书条码。');
      return;
    }
    setLookingUp(true);
    setLookupStatus('正在检索系统已有图书资料…');
    try {
      const result = await lookupBookData(token, isbn);
      if (!lookupSequence.current.current(request)) return;
      if (!result.book) {
        setExistingProductId(null);
        setExistingBook(false);
        setLookupStatus('系统中未找到该编码的资料，请手动填写必填字段。');
        return;
      }
      setExistingBook(result.source === 'LOCAL');
      setExistingProductId(result.existingProductId);
      const book = result.book;
      setV((current) => ({
        ...current,
        name: book.title,
        coverUrl: book.coverUrl,
        book,
        ...(result.suggestedPriceMinor === null
          ? {}
          : { sku: { ...current.sku, priceMinor: result.suggestedPriceMinor } }),
      }));
      if (result.suggestedPriceMinor !== null)
        setPriceYuan((result.suggestedPriceMinor / 100).toFixed(2));
      setLookupStatus(
        result.source === 'LOCAL'
          ? '该图书已存在，不能重复创建。请查看或编辑已有图书。'
          : result.source === 'OPEN_LIBRARY'
            ? '已从 Open Library 回填资料；价格无可靠来源，请由用户确认填写。'
            : '已从系统现有资料回填，请确认后再保存。',
      );
    } catch {
      if (lookupSequence.current.current(request))
        setLookupStatus('图书资料检索失败，请手动填写必填字段。');
    } finally {
      if (lookupSequence.current.current(request)) setLookingUp(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError('');
    if (lookingUp) {
      setError('图书资料检索完成前不能保存。');
      return;
    }
    if (existingBook) {
      setError('该图书已存在，不能通过新增表单重复创建。请查看或编辑已有图书。');
      return;
    }
    const nextPriceMinor =
      !editingExisting && isBook ? parseYuanToMinor(priceYuan) : v.sku.priceMinor;
    if (nextPriceMinor === null) {
      setError('价格请输入 0.00 至 21474836.47 元，最多两位小数。');
      return;
    }
    if (isBook && !v.book?.isbn) {
      setError('图书编码为必填项。');
      return;
    }
    const next = {
      ...v,
      ...(isBook && !editingExisting ? { status: 'DRAFT' as const } : {}),
      sku: {
        ...v.sku,
        priceMinor: nextPriceMinor,
        ...(isBook && !editingExisting ? { availableForSale: false } : {}),
      },
    };
    setSaving(true);
    try {
      if (!isBook) {
        const nonBook = { ...next };
        nonBook.book = null;
        delete nonBook.expectedBookVersion;
        delete nonBook.expectedEditionVersion;
        await onSave(nonBook, requestKey);
      } else {
        const bookInput = { ...next, name: next.book?.title ?? next.name };
        await onSave(
          {
            ...bookInput,
            sku: editingExisting ? bookInput.sku : { ...bookInput.sku, code: undefined },
          },
          requestKey,
        );
      }
    } catch (reason) {
      if (reason instanceof CatalogApiError && reason.status === 409) {
        setStale(true);
        setError(reason.message || '商品或图书资料冲突，不能覆盖。');
      } else {
        setError(
          reason instanceof CatalogApiError
            ? reason.message
            : '保存失败，请检查字段、权限或输入内容。',
        );
      }
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="cms-form" onSubmit={(e) => void submit(e)}>
      <h3>{'id' in initial ? '编辑商品' : '新增商品'}</h3>
      <label>
        {!(!editingExisting && isBook) && (
          <>
            商品名
            <input
              required
              value={v.name}
              onChange={(e) => {
                invalidateLookup();
                setV({ ...v, name: e.target.value });
              }}
            />
          </>
        )}
      </label>
      <label>
        简介
        <textarea
          value={v.description ?? ''}
          onChange={(e) => {
            invalidateLookup();
            setV({ ...v, description: e.target.value || null });
          }}
        />
      </label>
      <label>
        封面 URL
        <input
          type="url"
          value={v.coverUrl ?? ''}
          onChange={(e) => {
            invalidateLookup();
            setV({ ...v, coverUrl: e.target.value || null });
          }}
        />
      </label>
      <label>
        状态
        <select
          value={v.status}
          disabled={!editingExisting && isBook}
          onChange={(e) => {
            invalidateLookup();
            setV({
              ...v,
              status:
                e.target.value === 'ACTIVE'
                  ? 'ACTIVE'
                  : e.target.value === 'INACTIVE'
                    ? 'INACTIVE'
                    : 'DRAFT',
            });
          }}
        >
          <option>DRAFT</option>
          <option>ACTIVE</option>
          <option>INACTIVE</option>
        </select>
      </label>
      {!editingExisting && (
        <label>
          <input
            type="checkbox"
            checked={isBook}
            onChange={(event) => {
              invalidateLookup();
              const next = event.target.checked;
              setIsBook(next);
              if (!next) setV((current) => ({ ...current, book: null }));
              else if (v.book === null) {
                setV((current) => ({
                  ...current,
                  book: { title: '', author: '', isbn: null, publisher: null },
                }));
              }
            }}
          />
          图书商品
        </label>
      )}
      {isBook && (
        <>
          <label>
            图书名称
            <input
              required
              value={v.book?.title ?? ''}
              onChange={(e) => updateBook('title', e.target.value)}
            />
          </label>
          <label>
            作者
            <input
              required
              value={v.book?.author ?? ''}
              onChange={(e) => updateBook('author', e.target.value)}
            />
          </label>
          <label>
            图书编码（ISBN / 可扫描条码）
            <input
              required
              value={v.book?.isbn ?? ''}
              onChange={(e) => updateBook('isbn', e.target.value)}
              onBlur={() => void lookupBook()}
            />
            <button type="button" disabled={lookingUp} onClick={() => void lookupBook()}>
              {lookingUp ? '检索中…' : '检索已有资料'}
            </button>
            {lookupStatus && <small role="status">{lookupStatus}</small>}
            {existingProductId && (
              <button type="button" onClick={() => void onOpenExisting(existingProductId)}>
                查看或编辑已有图书
              </button>
            )}
          </label>
          <label>
            出版社
            <input
              value={v.book?.publisher ?? ''}
              onChange={(e) => updateBook('publisher', e.target.value)}
            />
          </label>
        </>
      )}
      {(editingExisting || !isBook) && (
        <label>
          SKU 编码
          <input
            required
            value={v.sku.code}
            onChange={(e) => {
              invalidateLookup();
              setV({ ...v, sku: { ...v.sku, code: e.target.value } });
            }}
          />
        </label>
      )}
      <label>
        SKU 名称
        <input
          required
          value={v.sku.name}
          onChange={(e) => {
            invalidateLookup();
            setV({ ...v, sku: { ...v.sku, name: e.target.value } });
          }}
        />
      </label>
      <label>
        价格（人民币元）
        <input
          inputMode="decimal"
          required
          value={!editingExisting && isBook ? priceYuan : (v.sku.priceMinor / 100).toFixed(2)}
          onChange={(e) => {
            invalidateLookup();
            if (!editingExisting && isBook) setPriceYuan(e.target.value);
            else {
              const minor = parseYuanToMinor(e.target.value);
              setV({ ...v, sku: { ...v.sku, priceMinor: minor ?? v.sku.priceMinor } });
            }
          }}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={v.sku.availableForSale}
          disabled={!editingExisting && isBook}
          onChange={(e) => {
            invalidateLookup();
            setV({ ...v, sku: { ...v.sku, availableForSale: e.target.checked } });
          }}
        />
        可售
      </label>
      <label>
        SKU 状态
        <select
          value={v.sku.status}
          onChange={(e) => {
            invalidateLookup();
            setV({
              ...v,
              sku: { ...v.sku, status: e.target.value === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE' },
            });
          }}
        >
          <option>ACTIVE</option>
          <option>INACTIVE</option>
        </select>
      </label>
      {error && <p role="status">{error}</p>}
      {stale && (
        <button type="button" onClick={onReload}>
          重新加载最新商品资料
        </button>
      )}
      <button type="button" onClick={onCancel}>
        取消
      </button>
      <button disabled={stale || lookingUp || existingBook || saving}>
        {saving ? '保存中…' : '保存'}
      </button>
    </form>
  );
}
