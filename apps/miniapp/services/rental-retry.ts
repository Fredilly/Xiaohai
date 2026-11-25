// WeChat storage keeps outstanding rental requests under a verified consumer ID.
// A key is saved BEFORE POST; an unconfirmed response must replay that key.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function storageKey(userId: string, storeId: string, skuId: string): string {
  if (![userId, storeId, skuId].every((id) => uuid.test(id)))
    throw new Error('INVALID_RENTAL_CONTEXT');
  return `xiaohai.rental.pending.${userId.toLowerCase()}.${storeId.toLowerCase()}.${skuId.toLowerCase()}`;
}

function cancellationStorageKey(userId: string, rentalId: string): string {
  if (![userId, rentalId].every((id) => uuid.test(id))) throw new Error('INVALID_RENTAL_CONTEXT');
  return `xiaohai.rental.cancel.pending.${userId.toLowerCase()}.${rentalId.toLowerCase()}`;
}

function readKey(key: string): string | null {
  const value: unknown = wx.getStorageSync(key);
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !uuid.test(value)) throw new Error('RENTAL_REQUEST_KEY_INVALID');
  return value;
}

function persistKey(key: string, requestKey: string): void {
  if (!uuid.test(requestKey)) throw new Error('RENTAL_REQUEST_KEY_INVALID');
  const existing = readKey(key);
  if (existing && existing !== requestKey) throw new Error('RENTAL_REQUEST_KEY_CONFLICT');
  wx.setStorageSync(key, requestKey);
}

function clearKey(key: string, requestKey: string): void {
  const existing = readKey(key);
  if (!existing) return;
  if (existing !== requestKey) throw new Error('RENTAL_REQUEST_KEY_CONFLICT');
  wx.removeStorageSync(key);
}

export function pendingRentalKey(userId: string, storeId: string, skuId: string): string | null {
  return readKey(storageKey(userId, storeId, skuId));
}

export function persistRentalKey(
  userId: string,
  storeId: string,
  skuId: string,
  requestKey: string,
): void {
  persistKey(storageKey(userId, storeId, skuId), requestKey);
}

export function clearRentalKey(
  userId: string,
  storeId: string,
  skuId: string,
  requestKey: string,
): void {
  clearKey(storageKey(userId, storeId, skuId), requestKey);
}

export const pendingCancellationKey = (userId: string, rentalId: string) =>
  readKey(cancellationStorageKey(userId, rentalId));

export const persistCancellationKey = (userId: string, rentalId: string, requestKey: string) =>
  persistKey(cancellationStorageKey(userId, rentalId), requestKey);

export const clearCancellationKey = (userId: string, rentalId: string, requestKey: string) =>
  clearKey(cancellationStorageKey(userId, rentalId), requestKey);
