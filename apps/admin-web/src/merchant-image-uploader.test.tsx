import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { merchantProductGalleryUpdateSchema } from '@xiaohai/contracts/commerce';
import {
  HqProductImageUploader,
  moveHqGalleryImage,
  previewableHqGalleryImage,
  removeHqGalleryImage,
} from './merchant-image-uploader';

describe('HQ draft product image intake (#208)', () => {
  it('renders an accessible image file picker, allowed types and draft-only policy', () => {
    const html = renderToStaticMarkup(
      <HqProductImageUploader
        token="test"
        productId="11111111-1111-4111-8111-111111111111"
        productVersion={0}
        onUploaded={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('上传与管理商品图片');
    expect(html).toContain('type="file"');
    expect(html).toContain('image/jpeg,image/png,image/webp');
    expect(html).toContain('未上架草稿');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="总部商品图库排序与主图"');
    expect(html).toContain('保存图库调整');
    expect(html).toContain('disabled=""'); // Mutations wait for the server gallery snapshot.
  });

  it('only previews safe, unsigned public HTTPS gallery images', () => {
    expect(previewableHqGalleryImage('https://public.cd.bcebos.com/img.jpg')).toBe(true);
    for (const value of [
      'http://public.cd.bcebos.com/img.jpg',
      'https://public.cd.bcebos.com/img.jpg?signature=private',
      'https://user:secret@public.cd.bcebos.com/img.jpg',
      'https://internal.localhost/img.jpg',
      'https://public.cd.bcebos.com:8443/img.jpg',
      'not a URL',
    ]) {
      expect(previewableHqGalleryImage(value)).toBe(false);
    }
  });

  it('keeps a valid ID-only order and cover after moving and removing HQ gallery images', () => {
    const first = '11111111-1111-4111-8111-111111111111';
    const second = '22222222-2222-4222-8222-222222222222';
    const images = [
      { id: first, url: 'https://public.example.com/a.png', displayOrder: 0 },
      { id: second, url: 'https://public.example.com/b.png', displayOrder: 1 },
    ];
    const moved = moveHqGalleryImage(images, 1, -1);
    expect(moved.map((item) => item.id)).toEqual([second, first]);
    expect(images.map((item) => item.id)).toEqual([first, second]);
    expect(moveHqGalleryImage(images, 0, -1)).toBe(images);

    const removed = removeHqGalleryImage(moved, second, second);
    expect(removed.images.map((item) => item.id)).toEqual([first]);
    expect(removed.coverImageId).toBe(first);
    expect(
      merchantProductGalleryUpdateSchema.parse({
        expectedProductVersion: 4,
        imageIds: removed.images.map((item) => item.id),
        coverImageId: removed.coverImageId,
      }),
    ).toBeDefined();

    const empty = removeHqGalleryImage(removed.images, first, removed.coverImageId);
    expect(empty).toEqual({ images: [], coverImageId: null });
    expect(
      merchantProductGalleryUpdateSchema.parse({
        expectedProductVersion: 4,
        imageIds: empty.images.map((item) => item.id),
        coverImageId: empty.coverImageId,
      }),
    ).toBeDefined();
    expect(removeHqGalleryImage(images, 'unknown', first).images).toBe(images);
  });
});
