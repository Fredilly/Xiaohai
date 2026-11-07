import { useEffect, useState, type FormEvent } from 'react';
import type {
  AdminProductCreateInput,
  StoreCatalogEditRequest,
  StoreCatalogItem,
} from '@xiaohai/contracts/commerce';
import {
  createStoreDraftProduct,
  listStoreCatalog,
  previewStoreCatalogEdit,
  updateStoreCatalog,
} from './store-catalog-api';

const limit = 30;

// Keep price parsing lossless and consistent with the HQ editor.
// Invalid, negative, fractional-fen and overflow values never reach the API.
export function parseStorePriceToMinor(value: string): number | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return null;
  const [yuan = '', fraction = ''] = value.split('.');
  const minor = BigInt(yuan) * 100n + BigInt((fraction + '00').slice(0, 2));
  return minor <= 2147483647n ? Number(minor) : null;
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
  const [creating, setCreating] = useState(false);
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
        可编辑本店关联商品的名称、售价及本店陈列信息。若商品资料还影响其他门店，
        系统会拒绝直接修改，避免未经确认覆盖其他门店的共享数据。
      </p>
      <div className="meiping-store-actions">
        <button type="button" onClick={() => setCreating(true)}>
          新增非图书商品草稿
        </button>
        <small>新商品默认未上架、不可售、库存为 0，须经过后续正式上架流程。</small>
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
      {creating && (
        <div className="catalog-editor-overlay" role="presentation">
          <div
            className="catalog-editor-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="新增非图书商品草稿"
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

function StoreCatalogDraftCreateForm({
  token,
  storeId,
  onCancel,
  onSaved,
}: {
  token: string;
  storeId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [name, setName] = useState('');
  const [skuName, setSkuName] = useState('标准');
  const [skuCode, setSkuCode] = useState('');
  const [priceYuan, setPriceYuan] = useState('');
  const [description, setDescription] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('仅创建未上架草稿，不自动录入真实库存。');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const priceMinor = parseStorePriceToMinor(priceYuan);
    if (!name.trim() || !skuName.trim() || priceMinor === null) {
      setStatus('请填写商品名称、规格及有效的价格（最多两位小数）。');
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
      name: name.trim(),
      description: description.trim() || null,
      coverUrl: cover || null,
      status: 'DRAFT',
      book: null,
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
    try {
      await createStoreDraftProduct(token, storeId, input, idempotencyKey);
      onSaved();
    } catch (error) {
      // Keep the same request key so a network retry cannot duplicate a draft.
      setStatus(error instanceof Error ? error.message : '创建失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="catalog-correction-form" onSubmit={(event) => void save(event)}>
      <h3>新增非图书商品</h3>
      <p>可先录入真实商品资料，但默认不会公开上架或产生任何库存数量。</p>
      <label>
        商品名称
        <input required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
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
        商品封面 HTTPS URL（上传功能另行接入）
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
  const [draft, setDraft] = useState(() => draftFor(item));
  const [name, setName] = useState(item.productName);
  const [priceYuan, setPriceYuan] = useState(() => (item.priceMinor / 100).toFixed(2));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(
    '本店独立商品可修改名称和价格；跨店共享商品需先明确跨店编辑规则。',
  );

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const priceMinor = parseStorePriceToMinor(priceYuan);
    if (priceMinor === null || !name.trim()) {
      setStatus('请填写有效的商品名称及价格（最多两位小数）。');
      return;
    }
    const input: StoreCatalogEditRequest = {
      ...draft,
      ...(name.trim() !== item.productName ? { productName: name.trim() } : {}),
      ...(priceMinor !== item.priceMinor ? { priceMinor } : {}),
    };
    const editsShared = input.productName !== undefined || input.priceMinor !== undefined;
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
        名称与售价变更需经过服务端影响范围核对；如涉及其他门店，本次保存将被拒绝，原数据不会变更。
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
