import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = readFileSync(new URL('./checkout.wxml', import.meta.url), 'utf8');

describe('Checkout delivery address recovery', () => {
  it('offers a direct address action when delivery has no saved address', () => {
    expect(template).toContain(
      'wx:elif="{{method === \'DELIVERY\' && stores.length > 0 && !addresses.length}}"',
    );
    expect(template).toContain('bindtap="goToAddress">添加配送地址</button>');
    expect(template).toContain('wx:elif="{{orderAttempted}}" bindtap="openOrders"');
    expect(template).toContain('wx:if="{{needsLogin}}" bindtap="goToLogin"');
  });
});
