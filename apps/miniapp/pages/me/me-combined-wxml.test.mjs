import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = readFileSync(new URL('./me.wxml', import.meta.url), 'utf8');

describe('Me Reader Passport and order views integration', () => {
  it('preserves the Reader Passport design and real login action', () => {
    expect(template).toContain('class="passport-hero"');
    expect(template).toContain('bindtap="login"');
  });

  it('preserves the view parameter on the repeated order tiles', () => {
    const tileStart = template.indexOf('class="order-item"');
    const tileEnd = template.indexOf('bindtap="openFeature"', tileStart);
    const tile = template.slice(tileStart, tileEnd);

    expect(tileStart).toBeGreaterThan(-1);
    expect(tile).toContain('wx:for="{{orderActions}}"');
    expect(tile).toContain('data-key="{{item.key}}"');
    expect(tile).toContain('data-view="{{item.view}}"');
  });

  it('preserves unfiltered View All and the eight service actions', () => {
    expect(template).toContain('class="card-heading-link"');
    expect(template).toContain('wx:for="{{serviceTiles}}"');
    expect(template).toContain('data-key="orders" bindtap="openFeature"');
  });
});
