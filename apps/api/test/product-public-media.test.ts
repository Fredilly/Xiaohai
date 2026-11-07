import { describe, expect, it } from 'vitest';
import { publicProductGalleryUrls } from '../src/commerce/product-public-media.js';

describe('public merchandise product media URL safety (#208)', () => {
  it('retains bounded, ordered, deduplicated HTTPS media without reordering', () => {
    expect(
      publicProductGalleryUrls([
        ' https://xiaohai-prod-assets.cd.bcebos.com/products/first.jpg ',
        'https://xiaohai-prod-assets.cd.bcebos.com/products/first.jpg',
        'https://other-cdn.example.com/products/second.webp',
      ]),
    ).toEqual([
      'https://xiaohai-prod-assets.cd.bcebos.com/products/first.jpg',
      'https://other-cdn.example.com/products/second.webp',
    ]);
  });

  it('rejects credentials, private/signed URLs, placeholders and local hosts', () => {
    expect(
      publicProductGalleryUrls([
        'http://cdn.example.com/image.png',
        'https://user:secret@cdn.example.com/image.png',
        'https://cdn.example.com/image.png?X-Amz-Signature=redacted',
        'https://cdn.example.com/image.png#private',
        'https://localhost/image.png',
        'https://127.0.0.1/image.png',
        'https://192.168.0.1/image.png',
        'https://10.1.2.3/image.png',
        'https://172.16.1.3/image.png',
        'https://assets.example.invalid/image.png',
        'javascript:alert(1)',
        'bad-url',
        '',
        'https://cdn.example.com/',
      ]),
    ).toEqual([]);
  });

  it('never returns more than eight images, with an input-size guard', () => {
    const many = Array.from({ length: 40 }, (_, i) => `https://cdn.example.com/a/${i}.jpg`);
    const imageUrls = publicProductGalleryUrls([
      'https://cdn.example.com/' + 'a'.repeat(2200),
      ...many,
    ]);
    expect(imageUrls).toHaveLength(8);
    expect(imageUrls[0]).toBe('https://cdn.example.com/a/0.jpg');
    expect(imageUrls[7]).toBe('https://cdn.example.com/a/7.jpg');
  });
});
