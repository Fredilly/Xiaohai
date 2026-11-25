// A withdrawal request key must survive a network timeout, page navigation and
// Mini Program restart. Scope storage by verified Consumer user ID, never token.
const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type PendingWithdrawal = {
  amountMinor: number;
  clientRequestId: string;
};

export function withdrawalAmountMinor(value: string): number | null {
  const amount = value.trim();
  if (!/^(0|[1-9]\d{0,7})(?:\.(\d{1,2}))?$/u.test(amount)) return null;
  const [yuan, fraction = ''] = amount.split('.');
  const minor = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) && minor > 0 && minor <= 2147483647 ? minor : null;
}

function keyFor(userId: string): string {
  if (!userIdPattern.test(userId)) throw new Error('INVALID_CONSUMER_ID');
  return `xiaohai.commission.pending-withdrawal.${userId.toLowerCase()}`;
}

export function readPendingWithdrawal(userId: string): PendingWithdrawal | null {
  const raw: unknown = wx.getStorageSync(keyFor(userId));
  if (raw === undefined || raw === null || raw === '') return null;
  if (!raw || typeof raw !== 'object') throw new Error('PENDING_WITHDRAWAL_INVALID');
  const value = raw as Record<string, unknown>;
  if (
    !Number.isSafeInteger(value.amountMinor) ||
    Number(value.amountMinor) <= 0 ||
    Number(value.amountMinor) > 2147483647 ||
    typeof value.clientRequestId !== 'string' ||
    value.clientRequestId.length < 8 ||
    value.clientRequestId.length > 128
  ) {
    throw new Error('PENDING_WITHDRAWAL_INVALID');
  }
  return { amountMinor: value.amountMinor as number, clientRequestId: value.clientRequestId };
}

export function persistPendingWithdrawal(userId: string, pending: PendingWithdrawal): void {
  // Never overwrite an unconfirmed operation with a different amount/key.
  const existing = readPendingWithdrawal(userId);
  if (
    existing &&
    (existing.clientRequestId !== pending.clientRequestId ||
      existing.amountMinor !== pending.amountMinor)
  ) {
    throw new Error('PENDING_WITHDRAWAL_CONFLICT');
  }
  wx.setStorageSync(keyFor(userId), pending);
}

export function clearPendingWithdrawal(userId: string, clientRequestId: string): void {
  const current = readPendingWithdrawal(userId);
  if (!current) return;
  if (current.clientRequestId !== clientRequestId) throw new Error('PENDING_WITHDRAWAL_CONFLICT');
  wx.removeStorageSync(keyFor(userId));
}
