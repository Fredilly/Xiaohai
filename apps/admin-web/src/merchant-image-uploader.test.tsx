import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HqProductImageUploader } from './merchant-image-uploader';

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
    expect(html).toContain('上传商品图片');
    expect(html).toContain('type="file"');
    expect(html).toContain('image/jpeg,image/png,image/webp');
    expect(html).toContain('未上架草稿');
    expect(html).toContain('role="status"');
  });
});
