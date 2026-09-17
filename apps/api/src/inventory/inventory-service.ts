import { and, asc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import {
  publicInventoryItemSchema,
  publicInventorySearchResponseSchema,
  type PublicInventoryQuery,
} from '@xiaohai/contracts/inventory';
import {
  bookEditions,
  books,
  franchisees,
  products,
  regions,
  skus,
  storeInventory,
  stores,
  type createDatabase,
} from '@xiaohai/db';

type Database = ReturnType<typeof createDatabase>['db'];

export class InventorySearchService {
  constructor(private readonly db: Database) {}

  async searchPublicBooks(input: PublicInventoryQuery) {
    const latitude = input.latitude;
    const longitude = input.longitude;
    const radiusKm = input.radiusKm ?? 50;
    const limit = input.limit ?? 50;

    const availableSql = sql<number>`(${storeInventory.onHand} - ${storeInventory.reserved} - ${storeInventory.rentalReserved})`;
    const distanceSql =
      latitude !== undefined && longitude !== undefined
        ? sql<number>`6371 * 2 * asin(
            least(
              1,
              sqrt(
                power(sin(radians(${stores.latitude} - ${latitude}) / 2), 2) +
                cos(radians(${latitude})) *
                cos(radians(${stores.latitude})) *
                power(sin(radians(${stores.longitude} - ${longitude}) / 2), 2)
              )
            )
          )`
        : null;

    const rows = await this.db
      .select({
        bookId: books.id,
        title: books.title,
        author: books.author,
        isbn: bookEditions.isbn,
        publisher: bookEditions.publisher,
        productId: products.id,
        productName: products.name,
        coverUrl: products.coverUrl,
        skuId: skus.id,
        skuCode: skus.code,
        skuName: skus.name,
        priceMinor: skus.priceMinor,
        availableForSale: skus.availableForSale,
        onHand: storeInventory.onHand,
        reserved: storeInventory.reserved,
        rentalReserved: storeInventory.rentalReserved,
        available: availableSql,
        storeId: stores.id,
        storeCode: stores.code,
        storeName: stores.name,
        countryCode: stores.countryCode,
        countryName: stores.countryName,
        city: stores.city,
        timezone: stores.timezone,
        addressLine: stores.addressLine,
        latitude: stores.latitude,
        longitude: stores.longitude,
        phone: stores.phone,
        openingHoursText: stores.openingHoursText,
        services: stores.services,
        regionId: regions.id,
        regionCode: regions.code,
        regionName: regions.name,
        regionCountryCode: regions.countryCode,
        regionCountryName: regions.countryName,
      })
      .from(storeInventory)
      .innerJoin(skus, eq(storeInventory.skuId, skus.id))
      .innerJoin(products, eq(skus.productId, products.id))
      .innerJoin(bookEditions, eq(products.bookEditionId, bookEditions.id))
      .innerJoin(books, eq(bookEditions.bookId, books.id))
      .innerJoin(stores, eq(storeInventory.storeId, stores.id))
      .innerJoin(regions, eq(stores.regionId, regions.id))
      .leftJoin(franchisees, eq(stores.franchiseeId, franchisees.id))
      .where(
        and(
          eq(products.status, 'ACTIVE'),
          eq(skus.status, 'ACTIVE'),
          eq(stores.operationalStatus, 'ACTIVE'),
          eq(regions.operationalStatus, 'ACTIVE'),
          or(isNull(stores.franchiseeId), eq(franchisees.operationalStatus, 'ACTIVE')),
          sql`${availableSql} > 0`,
          input.availability === 'SALE' ? eq(skus.availableForSale, true) : undefined,
          input.q
            ? or(
                ilike(books.title, `%${input.q}%`),
                ilike(books.author, `%${input.q}%`),
                ilike(bookEditions.publisher, `%${input.q}%`),
                ilike(bookEditions.isbn, `%${input.q}%`),
                ilike(skus.code, `%${input.q}%`),
                ilike(products.name, `%${input.q}%`),
              )
            : undefined,
          input.storeId ? eq(stores.id, input.storeId) : undefined,
          input.regionId ? eq(stores.regionId, input.regionId) : undefined,
          input.city ? ilike(stores.city, input.city) : undefined,
          distanceSql ? sql`${distanceSql} <= ${radiusKm}` : undefined,
        ),
      )
      .orderBy(
        distanceSql ? asc(distanceSql) : asc(books.title),
        asc(books.title),
        asc(stores.name),
      )
      .limit(limit);

    return publicInventorySearchResponseSchema.parse({
      items: rows.map((row) => {
        const available = Math.max(0, row.available);
        return publicInventoryItemSchema.parse({
          book: {
            id: row.bookId,
            title: row.title,
            author: row.author,
            isbn: row.isbn,
            publisher: row.publisher,
          },
          product: {
            id: row.productId,
            name: row.productName,
            coverUrl: row.coverUrl,
          },
          sku: {
            id: row.skuId,
            code: row.skuCode,
            name: row.skuName,
            priceMinor: row.priceMinor,
          },
          store: {
            id: row.storeId,
            code: row.storeCode,
            name: row.storeName,
            region: {
              id: row.regionId,
              code: row.regionCode,
              name: row.regionName,
              countryCode: row.regionCountryCode,
              countryName: row.regionCountryName,
            },
            countryCode: row.countryCode,
            countryName: row.countryName,
            city: row.city,
            timezone: row.timezone,
            addressLine: row.addressLine,
            latitude: row.latitude,
            longitude: row.longitude,
            phone: row.phone,
            openingHoursText: row.openingHoursText,
            services: normalizeServices(row.services),
            distanceKm:
              latitude !== undefined && longitude !== undefined
                ? haversineKm(latitude, longitude, row.latitude, row.longitude)
                : null,
          },
          stock: {
            onHand: row.onHand,
            reserved: row.reserved,
            rentalReserved: row.rentalReserved,
            available,
          },
          sellAvailable: available > 0 && row.availableForSale,
          rentAvailable: available > 0,
        });
      }),
    });
  }
}

function normalizeServices(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLatitude = toRadians(lat2 - lat1);
  const deltaLongitude = toRadians(lon2 - lon1);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
