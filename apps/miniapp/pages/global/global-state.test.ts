import { describe, expect, it } from 'vitest';
import { storeCountLabel, storeListState } from './global-state';

describe('global store data states', () => {
  it('does not turn an unavailable store count into zero', () => {
    expect(storeCountLabel('loading', 0)).toBe('加载中');
    expect(storeCountLabel('error', 0)).toBe('数量未知');
    expect(storeCountLabel('ready', 0)).toBe('0 家门店');
  });

  it('keeps loading, error, empty, and populated states distinct', () => {
    expect(storeListState('loading', 0)).toBe('loading');
    expect(storeListState('error', 0)).toBe('error');
    expect(storeListState('ready', 0)).toBe('empty');
    expect(storeListState('ready', 2)).toBe('ready');
  });
});
