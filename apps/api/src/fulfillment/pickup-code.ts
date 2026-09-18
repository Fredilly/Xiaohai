import { createHmac, timingSafeEqual } from 'node:crypto';

export type PickupResourceType = 'ORDER' | 'RENTAL';

export function pickupCodeFor(
  secret: string,
  resourceType: PickupResourceType,
  resourceId: string,
): string {
  const digest = createHmac('sha256', secret)
    .update(`${resourceType}:${resourceId}`)
    .digest();
  const value = digest.readUInt32BE(0) % 1_000_000;
  return String(value).padStart(6, '0');
}

export function pickupCodeMatches(
  secret: string,
  resourceType: PickupResourceType,
  resourceId: string,
  candidate: string,
): boolean {
  if (!/^\d{6}$/.test(candidate)) return false;
  const expected = pickupCodeFor(secret, resourceType, resourceId);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(candidate));
}
