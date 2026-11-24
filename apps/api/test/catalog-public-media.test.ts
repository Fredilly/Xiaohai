import { describe, expect, it } from 'vitest';
import { isPublicProductImageUrl } from '../src/commerce/commerce-service.js';

describe('public catalog image URLs (#208)', () => {
  it('accepts stable public HTTPS images only', () => {
    expect(isPublicProductImageUrl('https://cdn.example.com/shop/sku.jpg')).toBe(true);
    for (const value of [
      'http://cdn.example.com/sku.jpg',
      'https://cdn.example.com/sku.jpg?signature=private',
      'https://cdn.example.com/sku.jpg#token',
      'https://user:password@cdn.example.com/sku.jpg',
      'https://localhost/image.jpg',
      'https://127.0.0.1/image.jpg',
      'https://[::1]/image.jpg',
      'https://cdn.example.invalid/image.jpg',
      'https://internal.local/image.jpg',
      '/relative-image.jpg',
      'https://cdn.example.com/' + 'a'.repeat(2100),
    ]) {
      expect(isPublicProductImageUrl(value), value).toBe(false);
    }
  });
});
