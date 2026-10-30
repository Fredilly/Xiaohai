import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = readFileSync(new URL('./me.wxml', import.meta.url), 'utf8');

function openingTag(className) {
  const start = template.indexOf('class="' + className + '"');
  expect(start, 'Missing ' + className + ' click target').toBeGreaterThan(-1);
  const beginning = template.lastIndexOf('<view', start);
  const end = template.indexOf('>', start);
  expect(beginning).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return template.slice(beginning, end + 1);
}

describe('Me order shortcut WXML wiring (PR #139 / PR #134 integration guard)', () => {
  it('binds each repeated order tile to its view parameter and click handler', () => {
    const tile = openingTag('order-item');
    expect(tile).toContain('wx:for="{{orderActions}}"');
    expect(tile).toContain('data-key="{{item.key}}"');
    expect(tile).toContain('data-view="{{item.view}}"');
    expect(tile).toContain('bindtap="openFeature"');
  });

  it('keeps View All unfiltered and separately clickable', () => {
    const all = openingTag('card-heading-link');
    expect(all).toContain('data-key="orders"');
    expect(all).toContain('bindtap="openFeature"');
    expect(all).not.toContain('data-view=');
  });

  it('preserves login and service click bindings', () => {
    expect(template).toContain('bindtap="login"');
    const service = openingTag('service-item');
    expect(service).toContain('data-key="{{item.key}}"');
    expect(service).toContain('bindtap="openFeature"');
  });
});
