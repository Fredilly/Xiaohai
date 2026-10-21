import { useEffect, useState, type FormEvent } from 'react';
import type { StoreCatalogItem } from '@xiaohai/contracts/commerce';
import { listStoreCatalog } from './store-catalog-api';

const limit = 30;
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
        setStatus(page.items.length ? '展示本店已建立库存记录的商品资料（只读）' : '本店暂无关联库存的正式商品资料');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setItems([]);
        setMore(false);
        setStatus(error instanceof Error ? error.message : '读取商品资料失败');
      });
    return () => { active = false; };
  }, [token, storeId, applied, offset]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setApplied(query.trim());
  }

  return (
    <section className="panel store-catalog-panel">
      <span className="tag">日常商品资料 · 门店只读</span>
      <h2>本店商品资料</h2>
      <p>当前门店：{storeName}。仅显示与本店库存记录关联的商品及其基础资料，包括暂停销售或草稿状态的项目。</p>
      <p>图书书名、ISBN、出版社及 SKU 可能被多家门店共用。店长暂不能直接在这里修改全局商品资料；后续将单独开发提交纠错申请和授权复核。</p>
      <form className="book-search-form" onSubmit={search}>
        <input aria-label="搜索本店商品资料" maxLength={120} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="书名、作者、ISBN、出版社、SKU" />
        <button>搜索本店商品</button>
      </form>
      <div className="book-results">
        {items.map((item) => (
          <article className="book-result" key={item.storeId + ':' + item.skuId}>
            <div>
              <strong>{item.bookTitle || item.productName}</strong>
              <span>作者：{item.author || '未填写'} · 出版社：{item.publisher || '未填写'}</span>
              <small>ISBN：{item.isbn || '未填写'} · SKU：{item.skuCode}</small>
              <small>商品：{productStatus(item.productStatus)} · SKU：{skuStatus(item.skuStatus)}</small>
            </div>
            <div>
              <strong>现存 {item.onHand} · 可用 {item.available}</strong>
              <span>占用：{item.reserved + item.rentalReserved}</span>
              <small>库存版本 {item.inventoryVersion}</small>
            </div>
            <div>
              <strong>¥{(item.priceMinor / 100).toFixed(2)}</strong>
              <span>{item.availableForSale ? '可售标记：是' : '可售标记：否'}</span>
            </div>
          </article>
        ))}
      </div>
      <div className="meiping-store-actions">
        <button disabled={offset === 0} onClick={() => setOffset((n) => Math.max(0, n - limit))}>上一页</button>
        <span>第 {Math.floor(offset / limit) + 1} 页</span>
        <button disabled={!more} onClick={() => setOffset((n) => n + limit)}>下一页</button>
      </div>
      <p role="status">{status}</p>
    </section>
  );
}

export function productStatus(status: StoreCatalogItem['productStatus']): string {
  return { DRAFT: '草稿', ACTIVE: '已上架', INACTIVE: '已停用' }[status];
}
export function skuStatus(status: StoreCatalogItem['skuStatus']): string {
  return { ACTIVE: '有效', INACTIVE: '已停用' }[status];
}
