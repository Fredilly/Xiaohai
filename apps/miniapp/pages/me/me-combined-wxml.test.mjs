import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = readFileSync(new URL('./me.wxml', import.meta.url), 'utf8');

describe('Reader Passport / order shortcuts integration', () => {
  it('keeps the #134 reader-passport structure and its real login binding', () => {
    expect(template).toContain('class="passport-hero"');
    expect(template).toContain('bindtap="login"');
    expect(template).toContain('data-key="settings"');
  });

  it('binds the #139 order view on each repeated card in the #134 template', () => {
    const orderTile = template.match(
      /<view\s+class="order-item"[\s\S]*?bindtap="openFeature"[\s\S]*?>/,
    )?.[0];
    expect(orderTile).toContain('wx:for="{{orderActions}}"');
    expect(orderTile).toContain('data-key="{{item.key}}"');
    expect(orderTile).toContain('data-view="{{item.view}}"');
  });

  it('keeps View All free of a view filter and preserves service navigation', () => {
    expect(template).toContain(
      'class="card-heading-link" data-key="orders" bindtap="openFeature"',
    );
    expect(template).toContain('wx:for="{{serviceTiles}}"');
    expect(template).toContain('data-key="{{item.key}}"');
  });
});
