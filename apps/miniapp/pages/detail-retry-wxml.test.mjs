import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const loadTemplate = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');

describe('detail retry buttons are bound to their guarded handlers', () => {
  it('binds the rental retry button to the actual Page.retry handler', () => {
    const wxml = loadTemplate('./rental-detail/rental-detail.wxml');
    expect(wxml).toContain('bindtap="retry"');
    expect(wxml).not.toContain('bindtap="load"');
    expect(wxml).toContain('id && !loading && !accessMessage');
  });

  it('prevents a retry action on protected 401/403 detail views', () => {
    for (const path of [
      './product/product.wxml',
      './story-detail/story-detail.wxml',
      './store-detail/store-detail.wxml',
      './rental-detail/rental-detail.wxml',
    ]) {
      const wxml = loadTemplate(path);
      expect(wxml).toContain('bindtap="retry"');
      expect(wxml).toContain('!accessMessage');
    }
  });
});
