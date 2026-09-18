import type {
  CommissionRule,
  StaffCommissionOverview,
  Withdrawal,
} from '@xiaohai/contracts/commission';

const configuredBase: unknown = import.meta.env.VITE_API_BASE_URL;
const base = typeof configuredBase === 'string' ? configuredBase : 'http://127.0.0.1:3000';
async function call<T>(token: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json() as Promise<T>;
}
export type CommissionOverview = StaffCommissionOverview;
export type { CommissionRule, Withdrawal };
export const getCommissionOverview = (token: string) =>
  call<StaffCommissionOverview>(token, '/api/v1/staff/commissions');
export const createCommissionRule = (
  token: string,
  body: { name: string; rateBasisPoints: number; freezeDays: number; effectiveFrom: string },
) => call<CommissionRule>(token, '/api/v1/staff/commissions/rules', 'POST', body);
export const changeCommissionRuleStatus = (
  token: string,
  id: string,
  status: 'ACTIVE' | 'INACTIVE',
  version: number,
) =>
  call<CommissionRule>(token, `/api/v1/staff/commissions/rules/${id}/status`, 'POST', {
    status,
    version,
  });
export const reviewWithdrawal = (
  token: string,
  id: string,
  action: 'APPROVE' | 'REJECT' | 'MARK_PAID',
  version: number,
) =>
  call<Withdrawal>(token, `/api/v1/staff/commissions/withdrawals/${id}/review`, 'POST', {
    action,
    version,
  });
export const settleCommission = (token: string, eventId: string) =>
  call<{ settled: true }>(token, `/api/v1/staff/commissions/events/${eventId}/settle`, 'POST');
