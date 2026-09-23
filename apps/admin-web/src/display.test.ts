import { describe, expect, it } from 'vitest';
import { displayStatus, money } from './display';

describe('operations display', () => {
  it('shows readable labels without changing stored states', () => {
    expect(displayStatus('PICKUP_READY')).toBe('待自提');
    expect(displayStatus('REFUNDED')).toBe('已退款');
    expect(displayStatus('UNKNOWN_STATE')).toBe('UNKNOWN_STATE');
  });

  it('renders minor units as currency', () => {
    expect(money(12345)).toBe('¥123.45');
  });
});
