import type { CommissionAccount, ReferralLink, Withdrawal } from '@xiaohai/contracts/commission';
import { request } from './commerce';

export type { ReferralLink, CommissionAccount, Withdrawal };

export const listReferralLinks = () =>
  request<{ links: ReferralLink[] }>('/api/v1/referrals/links');
export const createReferralLink = (label?: string) =>
  request<ReferralLink>('/api/v1/referrals/links', 'POST', label ? { label } : {});
export const getCommissionAccount = () => request<CommissionAccount>('/api/v1/commissions/account');
export const listWithdrawals = () =>
  request<{ withdrawals: Withdrawal[] }>('/api/v1/commissions/withdrawals');
export const createWithdrawal = (amountMinor: number, clientRequestId: string) =>
  request<Withdrawal>('/api/v1/commissions/withdrawals', 'POST', { amountMinor, clientRequestId });
export const cancelWithdrawal = (id: string) =>
  request<Withdrawal>(`/api/v1/commissions/withdrawals/${id}/cancel`, 'POST');
