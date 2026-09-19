import { useEffect, useState, type FormEvent } from 'react';
import type { PublicInventoryItem } from '@xiaohai/contracts/inventory';
import { searchStoreBooks } from './book-search-api';

export function BookSearchPanel({ storeId, storeName }: { storeId: string; storeName: string }) {
  const [items, setItems] = useState<PublicInventoryItem[]>([]);
  const [status, setStatus] = useState(`可查询 ${storeName} 当前可用图书`);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setItems([]);
    setStatus(`可查询 ${storeName} 当前可用图书`);
  }, [storeId, storeName]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = form.get('query');
    const query = typeof value === 'string' ? value.trim() : '';
    setBusy(true);
    try {
      const result = await searchStoreBooks(storeId, query);
      setItems(result.items);
      setStatus(result.items.length ? `找到 ${result.items.length} 个库存结果` : '当前门店未找到可用库存');
    } catch (error) {
      setStatus(error instanceof Error ? `查询失败：${error.message}` : '查询失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <span className="tag">M13 Book + Store Inventory Search</span>
      <h2>图书查询</h2>
      <p>搜索范围固定为当前门店。支持书名、作者、出版社、ISBN、SKU / 条码相关编码。</p>
      <form className="book-search-form" onSubmit={(event) => void submit(event)}>
        <input name="query" maxLength={120} placeholder="输入书名、作者、ISBN 或条码" />
        <button disabled={busy}>{busy ? '查询中…' : '查询库存'}</button>
      </form>
      <div className="book-results">
        {items.map((item) => (
          <article key={`${item.store.id}:${item.sku.id}`} className="book-result">
            <div>
              <strong>{item.book.title}</strong>
              <span>{item.book.author}</span>
              <small>
                ISBN {item.book.isbn ?? '—'} · {item.sku.code}
              </small>
            </div>
            <div>
              <strong>可用 {item.stock.available}</strong>
              <span>现存 {item.stock.onHand}</span>
              <small>
                {item.sellAvailable ? '可售' : '不可售'} · {item.rentAvailable ? '可租' : '不可租'}
              </small>
            </div>
            <div>
              <strong>¥{(item.sku.priceMinor / 100).toFixed(2)}</strong>
              <span>{item.store.name}</span>
            </div>
          </article>
        ))}
      </div>
      <p role="status">{status}</p>
    </section>
  );
}
