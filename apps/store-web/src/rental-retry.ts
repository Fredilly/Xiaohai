// Rental action request keys remain per staff account, store, rental and action.
// The key is saved before POST so a network timeout cannot create a new action.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type RentalAction = 'borrow' | 'return';

function storageKey(
  staffAccountId: string,
  storeId: string,
  rentalId: string,
  action: RentalAction,
): string {
  if (![staffAccountId, storeId, rentalId].every((value) => uuid.test(value)))
    throw new Error('INVALID_RENTAL_CONTEXT');
  return `xiaohai.staff.rental.pending.${staffAccountId.toLowerCase()}.${storeId.toLowerCase()}.${rentalId.toLowerCase()}.${action}`;
}

function storedKey(key: string): string | null {
  const value = sessionStorage.getItem(key);
  if (value === null) return null;
  if (!uuid.test(value)) throw new Error('RENTAL_ACTION_KEY_INVALID');
  return value;
}

export function getOrCreateRentalActionKey(
  staffAccountId: string,
  storeId: string,
  rentalId: string,
  action: RentalAction,
): string {
  const key = storageKey(staffAccountId, storeId, rentalId, action);
  const existing = storedKey(key);
  if (existing) return existing;
  const requestKey = crypto.randomUUID();
  if (!uuid.test(requestKey)) throw new Error('RENTAL_ACTION_KEY_INVALID');
  sessionStorage.setItem(key, requestKey);
  return requestKey;
}

export function pendingRentalActionKey(
  staffAccountId: string,
  storeId: string,
  rentalId: string,
  action: RentalAction,
): string | null {
  return storedKey(storageKey(staffAccountId, storeId, rentalId, action));
}

export function clearRentalActionKey(
  staffAccountId: string,
  storeId: string,
  rentalId: string,
  action: RentalAction,
  requestKey: string,
): void {
  const key = storageKey(staffAccountId, storeId, rentalId, action);
  const existing = storedKey(key);
  if (!existing) return;
  if (existing !== requestKey) throw new Error('RENTAL_ACTION_KEY_CONFLICT');
  sessionStorage.removeItem(key);
}
