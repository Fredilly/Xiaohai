import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = readFileSync(new URL('./commission.wxml', import.meta.url), 'utf8');

describe('commission status action bindings', () => {
  it('offers Me navigation, not retry, for the unauthenticated state', () => {
    const start = template.indexOf("accountStatus === 'unauthenticated'");
    const end = template.indexOf("accountStatus === 'error'", start);
    const block = template.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(block).toContain('bindtap="goToLogin"');
    expect(block).not.toContain('bindtap="load"');
  });

  it('offers retry only for the actual error state', () => {
    const start = template.indexOf("accountStatus === 'error'");
    const end = template.indexOf('<block wx:else>', start);
    const block = template.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(block).toContain('bindtap="load"');
    expect(block).not.toContain('bindtap="goToLogin"');
  });
});
