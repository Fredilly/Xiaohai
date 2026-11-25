import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StoreProductImageUploader } from './merchant-image-uploader';

describe('Store-scoped draft product image intake (#208)', () => {
  it('renders a real image picker without exposing HQ account controls', () => {
    const html = renderToStaticMarkup(
      <StoreProductImageUploader
        token="test"
        storeId="11111111-1111-4111-8111-111111111111"
        productId="22222222-2222-4222-8222-222222222222"
        productVersion={0}
        onUploaded={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('上传与管理商品图片');
    expect(html).toContain('type="file"');
    expect(html).toContain('image/jpeg,image/png,image/webp');
    expect(html).toContain('商品图库排序与主图');
    expect(html).toContain('保存图库调整');
    expect(html).toContain('正在读取本店商品图库');
    expect(html).toContain('共享商品');
    expect(html).not.toContain('账号管理');
  });
});
