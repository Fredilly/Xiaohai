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
