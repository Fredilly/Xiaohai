import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RentalPanel } from './rental-panel';

describe('store rental workspace', () => {
  it('has an explicit refresh path without rendering staff credentials', () => {
    const markup = renderToStaticMarkup(
      <RentalPanel
        token="synthetic-token"
        staffAccountId="11111111-1111-4111-8111-111111111111"
        storeId="33333333-3333-4333-8333-333333333333"
      />,
    );
    expect(markup).toContain('刷新记录');
    expect(markup).toContain('取书码只由顾客端显示');
    expect(markup).not.toContain('synthetic-token');
  });
});
