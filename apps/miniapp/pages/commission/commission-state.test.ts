import { describe, expect, it } from 'vitest';
import { CommerceApiError } from '../../services/commerce';
import {
  canUseCommissionActions,
  classifyCommissionError,
  type CommissionAccountStatus,
} from './commission-state';

describe('commission account availability states', () => {
  it('classifies an expired consumer session separately from network/API errors', () => {
    expect(classifyCommissionError(new CommerceApiError(401))).toBe('unauthenticated');
    expect(classifyCommissionError(new CommerceApiError(503))).toBe('error');
    expect(classifyCommissionError(new Error('network unavailable'))).toBe('error');
  });

  it('allows sharing and withdrawal only after all account data is ready', () => {
    const unavailable: CommissionAccountStatus[] = ['loading', 'unauthenticated', 'error'];
    for (const status of unavailable) expect(canUseCommissionActions(status)).toBe(false);
    expect(canUseCommissionActions('ready')).toBe(true);
  });
});
