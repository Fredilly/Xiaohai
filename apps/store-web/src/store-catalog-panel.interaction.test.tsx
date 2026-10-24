// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreCatalogItem } from '@xiaohai/contracts/commerce';

const mocks = vi.hoisted(() => ({
  previewStoreCatalogEdit: vi.fn(),
  updateStoreCatalog: vi.fn(),
}));

vi.mock('./store-catalog-api', () => mocks);

import { StoreCatalogEditForm } from './store-catalog-panel';

const item: StoreCatalogItem = {
  storeId: '11111111-1111-4111-8111-111111111111',
  productId: '22222222-2222-4222-8222-222222222222',
  productName: '测试图书',
  productStatus: 'ACTIVE',
  coverUrl: null,
  bookTitle: '测试图书',
  author: '测试作者',
  isbn: '9787111111111',
  publisher: '测试出版社',
  skuId: '33333333-3333-4333-8333-333333333333',
  skuCode: 'TEST-SKU',
  skuName: '标准版',
  skuStatus: 'ACTIVE',
  priceMinor: 1200,
  availableForSale: true,
  onHand: 3,
  reserved: 0,
  rentalReserved: 0,
  available: 3,
  inventoryVersion: 1,
  productVersion: 1,
  bookVersion: 1,
  editionVersion: 1,
  skuVersion: 1,
  localVersion: 1,
  shelfLocation: 'A-01',
  storeNote: '备注',
  displayInfo: '正面陈列',
};

const impact = (affectedStoreCount: number) => ({
  sharedFields: ['priceMinor'],
  affectedStoreCount,
  affectedStoreIds: Array.from(
    { length: affectedStoreCount },
    (_, index) => `44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`,
  ),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('StoreCatalogEditForm interactions', () => {
  let root: Root;
  let container: HTMLElement;
  let confirmMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.previewStoreCatalogEdit.mockReset();
    mocks.updateStoreCatalog.mockReset();
    confirmMock = vi.fn(() => true);
    window.confirm = confirmMock;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
  });

  function renderForm() {
    root = createRoot(container);
    act(() => {
      root.render(
        <StoreCatalogEditForm
          token="test-token"
          storeId={item.storeId}
          item={item}
          onCancel={vi.fn()}
          onSaved={vi.fn()}
        />,
      );
    });
  }

  function setPrice(value: string) {
    const input = container.querySelector('input[aria-label="SKU 价格（元）"]') as HTMLInputElement;
    act(() => {
      // React's controlled-input tracker needs the native setter in happy-dom.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  async function click(label: string) {
    const button = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === label,
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
  }

  it('sends 1500 fen for 15.00 yuan and confirms the real price change', async () => {
    mocks.previewStoreCatalogEdit.mockResolvedValue({ impact: impact(2) });
    mocks.updateStoreCatalog.mockResolvedValue({});
    renderForm();
    setPrice('15.00');
    await click('计算共享影响范围');
    expect(mocks.previewStoreCatalogEdit).toHaveBeenCalledWith(
      'test-token',
      item.storeId,
      item.skuId,
      expect.objectContaining({ priceMinor: 1500 }),
    );
    await click('保存正式商品资料');
    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining('¥12.00 → ¥15.00'));
    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining('影响 2 家门店'));
    expect(mocks.updateStoreCatalog).toHaveBeenCalledWith(
      'test-token',
      item.storeId,
      item.skuId,
      expect.objectContaining({ priceMinor: 1500 }),
    );
  });

  it('does not call preview or save for an invalid amount', async () => {
    renderForm();
    setPrice('15.123');
    await click('计算共享影响范围');
    await click('保存正式商品资料');
    expect(mocks.previewStoreCatalogEdit).not.toHaveBeenCalled();
    expect(mocks.updateStoreCatalog).not.toHaveBeenCalled();
  });

  it('does not restore an old preview after the form changes', async () => {
    const first = deferred<{ impact: ReturnType<typeof impact> }>();
    mocks.previewStoreCatalogEdit.mockReturnValueOnce(first.promise);
    renderForm();
    setPrice('15.00');
    await click('计算共享影响范围');
    setPrice('16.00');
    await act(async () => {
      first.resolve({ impact: impact(2) });
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain('预计影响 2 家门店');
    await click('保存正式商品资料');
    expect(mocks.updateStoreCatalog).not.toHaveBeenCalled();
  });

  it('keeps the newest preview when an older request resolves last', async () => {
    const first = deferred<{ impact: ReturnType<typeof impact> }>();
    const second = deferred<{ impact: ReturnType<typeof impact> }>();
    mocks.previewStoreCatalogEdit
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderForm();
    setPrice('15.00');
    await click('计算共享影响范围');
    setPrice('16.00');
    await click('计算共享影响范围');
    await act(async () => {
      second.resolve({ impact: impact(3) });
      await Promise.resolve();
    });
    await act(async () => {
      first.resolve({ impact: impact(2) });
      await Promise.resolve();
    });
    expect(container.textContent).toContain('预计影响 3 家门店');
    expect(container.textContent).not.toContain('预计影响 2 家门店');
  });

  it('does not retry or silently overwrite after a 409 response', async () => {
    mocks.previewStoreCatalogEdit.mockResolvedValue({ impact: impact(1) });
    mocks.updateStoreCatalog.mockRejectedValue(new Error('商品资料已被其他人修改，请重新加载'));
    renderForm();
    setPrice('15.00');
    await click('计算共享影响范围');
    await click('保存正式商品资料');
    expect(mocks.updateStoreCatalog).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('商品资料已被其他人修改，请重新加载');
  });
});
