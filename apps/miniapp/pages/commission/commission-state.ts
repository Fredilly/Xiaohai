import { CommerceApiError } from '../../services/commerce';

export type CommissionAccountStatus = 'loading' | 'unauthenticated' | 'error' | 'ready';

export function classifyCommissionError(
  error: unknown,
): Exclude<CommissionAccountStatus, 'loading' | 'ready'> {
  if (error instanceof CommerceApiError && error.status === 401) return 'unauthenticated';
  return 'error';
}

export function canUseCommissionActions(status: CommissionAccountStatus): boolean {
  return status === 'ready';
}

export function commissionActionFailure(error: unknown, fallbackMessage: string) {
  if (classifyCommissionError(error) === 'unauthenticated') {
    return {
      accountStatus: 'unauthenticated' as const,
      error: '登录已失效，请重新登录后查看佣金信息。',
      frozenMinor: 0,
      availableMinor: 0,
      entries: [],
      links: [],
      withdrawals: [],
      amountYuan: '',
    };
  }
  return { error: fallbackMessage };
}
