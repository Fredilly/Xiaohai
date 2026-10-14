export type StoreDataStatus = 'loading' | 'error' | 'ready';

export function storeCountLabel(status: StoreDataStatus, count: number): string {
  if (status === 'loading') return '加载中';
  if (status === 'error') return '数量未知';
  return `${count} 家门店`;
}

export function storeListState(
  status: StoreDataStatus,
  count: number,
): 'loading' | 'error' | 'empty' | 'ready' {
  if (status === 'loading') return 'loading';
  if (status === 'error') return 'error';
  return count === 0 ? 'empty' : 'ready';
}
