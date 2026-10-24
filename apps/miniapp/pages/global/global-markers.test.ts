import type { PublicStore } from '@xiaohai/contracts/stores';
import { describe, expect, it } from 'vitest';
import { buildStoreMarkers, storeIdForMarker } from './global-markers';

type MarkerStore = Pick<PublicStore, 'id' | 'latitude' | 'longitude' | 'name'>;

const a: MarkerStore = {
  id: 'store-uuid-a',
  name: '测试门店 A',
  latitude: 30.657,
  longitude: 104.066,
};
const b: MarkerStore = {
  id: 'store-uuid-b',
  name: '测试门店 B',
  latitude: 30.68,
  longitude: 104.08,
};

describe('native map marker -> actual store identity', () => {
  it('keeps numeric marker IDs distinct from string API store IDs', () => {
    const stores = [a, b];
    expect(buildStoreMarkers(stores)).toEqual([
      { id: 1, latitude: a.latitude, longitude: a.longitude, title: a.name, width: 28, height: 28 },
      { id: 2, latitude: b.latitude, longitude: b.longitude, title: b.name, width: 28, height: 28 },
    ]);
    expect(storeIdForMarker(stores, 1)).toBe(a.id);
    expect(storeIdForMarker(stores, 2)).toBe(b.id);
  });

  it('uses the current store snapshot after filtering or reordering', () => {
    const filtered = [b];
    expect(buildStoreMarkers(filtered).map((marker) => marker.id)).toEqual([1]);
    expect(storeIdForMarker(filtered, 1)).toBe(b.id);
    expect(storeIdForMarker(filtered, 2)).toBeNull();

    const reordered = [b, a];
    expect(storeIdForMarker(reordered, 1)).toBe(b.id);
    expect(storeIdForMarker(reordered, 2)).toBe(a.id);
  });

  it('rejects invalid marker IDs and an empty result instead of guessing a store', () => {
    expect(buildStoreMarkers([])).toEqual([]);
    for (const id of [0, -1, 1.5, 3, NaN, Infinity]) {
      expect(storeIdForMarker([a, b], id)).toBeNull();
    }
    expect(storeIdForMarker([], 1)).toBeNull();
  });
});
