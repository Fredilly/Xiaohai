import type { PublicStore } from '@xiaohai/contracts/stores';

// The native WeChat map requires numeric marker IDs. Real store IDs are strings
// from the API; their relationship is the index in the current stores snapshot.
// Never coerce a store ID to a number, and never reuse an old snapshot after filtering.
type MarkerStore = Pick<PublicStore, 'id' | 'latitude' | 'longitude' | 'name'>;

export type StoreMarker = {
  id: number;
  latitude: number;
  longitude: number;
  title: string;
  width: number;
  height: number;
};

export function buildStoreMarkers(stores: readonly MarkerStore[]): StoreMarker[] {
  return stores.map((store, index) => ({
    id: index + 1,
    latitude: store.latitude,
    longitude: store.longitude,
    title: store.name,
    width: 28,
    height: 28,
  }));
}

/**
 * Resolve a map marker against the SAME filtered/sorted stores snapshot.
 * This is a pure checkable mapping; the UI intentionally keeps its existing
 * store-list navigation and does not add a marker-tap route in this PR.
 */
export function storeIdForMarker(
  stores: readonly MarkerStore[],
  markerId: number,
): string | null {
  if (!Number.isInteger(markerId) || markerId < 1) return null;
  return stores[markerId - 1]?.id ?? null;
}
