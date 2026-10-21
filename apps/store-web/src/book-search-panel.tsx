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
      setStatus(
        result.items.length ? `找到 ${result.items.length} 个库存结果` : '当前门店未找到可用库存',
      );
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
      <div className="data-table-scroll" role="region" aria-label="图书查询结果表格" tabIndex={0}>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">图书 / SKU</th>
              <th scope="col">作者</th>
              <th scope="col">ISBN</th>
              <th scope="col" className="numeric">
                现存 / 可用
              </th>
              <th scope="col" className="numeric">
                售价
              </th>
              <th scope="col">可售 / 可租</th>
              <th scope="col">门店</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.store.id}:${item.sku.id}`}>
                <td>
                  <strong className="cell-title">{item.book.title}</strong>
                  <small className="cell-meta">{item.sku.code}</small>
                </td>
                <td>{item.book.author}</td>
                <td className="cell-code">{item.book.isbn ?? '—'}</td>
                <td className="numeric">
                  {item.stock.onHand} / <strong>{item.stock.available}</strong>
                </td>
                <td className="numeric">¥{(item.sku.priceMinor / 100).toFixed(2)}</td>
                <td>
                  <span className="status-pill">{item.sellAvailable ? '可售' : '不可售'}</span>
                  <small className="cell-meta">{item.rentAvailable ? '可租' : '不可租'}</small>
                </td>
                <td>{item.store.name}</td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={7} className="data-table-empty">
                  查询后在此显示本店图书结果
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p role="status">{status}</p>
    </section>
  );
}
