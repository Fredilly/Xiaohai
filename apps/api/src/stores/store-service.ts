import { and, asc, eq, ilike, isNull, or } from 'drizzle-orm';
import {
  createFranchiseeRequestSchema,
  createRegionRequestSchema,
  createStoreRequestSchema,
  franchiseeSchema,
  publicRegionSchema,
  publicRegionsResponseSchema,
  publicStoreSchema,
  publicStoresResponseSchema,
  regionSchema,
  staffStoreSchema,
  staffStoresResponseSchema,
  updateFranchiseeRequestSchema,
  updateRegionRequestSchema,
  updateStoreRequestSchema,
  type CreateFranchiseeRequest,
  type CreateRegionRequest,
  type CreateStoreRequest,
  type PublicStoreQuery,
  type UpdateFranchiseeRequest,
  type UpdateRegionRequest,
  type UpdateStoreRequest,
} from '@xiaohai/contracts/stores';
import { franchisees, regions, stores, type createDatabase } from '@xiaohai/db';
import type { StaffAuthorizationContext } from '../auth/staff-authorization.js';

type Database = ReturnType<typeof createDatabase>['db'];

export type StoreNetworkErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'SCOPE_MISMATCH';
export class StoreNetworkError extends Error {
  constructor(readonly code: StoreNetworkErrorCode) {
    super(code);
  }
}

export class StoreNetworkService {
  constructor(private readonly db: Database) {}

  async listPublicRegions() {
    const rows = await this.db
      .select()
      .from(regions)
      .where(eq(regions.operationalStatus, 'ACTIVE'))
      .orderBy(asc(regions.displayOrder), asc(regions.name));

    return publicRegionsResponseSchema.parse({
      regions: rows.map((row) => publicRegionSchema.parse(row)),
    });
  }

  async listPublicStores(input: PublicStoreQuery) {
    const rows = await this.db
      .select({
        id: stores.id,
        code: stores.code,
        name: stores.name,
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
      .from(stores)
      .innerJoin(regions, eq(stores.regionId, regions.id))
      .leftJoin(franchisees, eq(stores.franchiseeId, franchisees.id))
      .where(
        and(
          eq(stores.operationalStatus, 'ACTIVE'),
          eq(regions.operationalStatus, 'ACTIVE'),
          or(isNull(stores.franchiseeId), eq(franchisees.operationalStatus, 'ACTIVE')),
          input.q ? ilike(stores.name, `%${input.q}%`) : undefined,
          input.regionId ? eq(stores.regionId, input.regionId) : undefined,
          input.city ? ilike(stores.city, input.city) : undefined,
          input.country
            ? or(
                ilike(stores.countryCode, input.country),
                ilike(stores.countryName, input.country),
              )
            : undefined,
        ),
      )
      .orderBy(asc(stores.name));

    const serviceFilter = input.service?.toLocaleLowerCase();
    const latitude = input.latitude;
    const longitude = input.longitude;
    const radiusKm = input.radiusKm ?? 50;

    const items = rows.flatMap((row) => {
      const services = normalizeServices(row.services);
      if (
        serviceFilter &&
        !services.some((service) => service.toLocaleLowerCase() === serviceFilter)
      ) {
        return [];
      }

      const distanceKm =
        latitude !== undefined && longitude !== undefined
          ? haversineKm(latitude, longitude, row.latitude, row.longitude)
          : null;
      if (distanceKm !== null && distanceKm > radiusKm) return [];

      return [
        publicStoreSchema.parse({
          id: row.id,
          code: row.code,
          name: row.name,
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
          services,
          distanceKm,
        }),
      ];
    });

    if (latitude !== undefined && longitude !== undefined) {
      items.sort((a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY));
    }

    return publicStoresResponseSchema.parse({ stores: items });
  }

  async getPublicStore(id: string) {
    const [row] = await this.db
      .select({
        id: stores.id,
        code: stores.code,
        name: stores.name,
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
      .from(stores)
      .innerJoin(regions, eq(stores.regionId, regions.id))
      .leftJoin(franchisees, eq(stores.franchiseeId, franchisees.id))
      .where(
        and(
          eq(stores.id, id),
          eq(stores.operationalStatus, 'ACTIVE'),
          eq(regions.operationalStatus, 'ACTIVE'),
          or(isNull(stores.franchiseeId), eq(franchisees.operationalStatus, 'ACTIVE')),
        ),
      )
      .limit(1);

    if (!row) throw new StoreNetworkError('NOT_FOUND');
    return publicStoreSchema.parse({
      id: row.id,
      code: row.code,
      name: row.name,
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
      distanceKm: null,
    });
  }

  async listStaffStores(context: StaffAuthorizationContext) {
    const rows = await this.loadStaffStoreRows();
    return staffStoresResponseSchema.parse({
      stores: rows.filter((row) => canAccessStore(context, row)).map(toStaffStore),
    });
  }

  async createRegion(context: StaffAuthorizationContext, raw: CreateRegionRequest) {
    if (!hasGlobal(context)) throw new StoreNetworkError('SCOPE_MISMATCH');
    const input = createRegionRequestSchema.parse(raw);
    try {
      const [created] = await this.db.insert(regions).values(input).returning();
      if (!created) throw new StoreNetworkError('CONFLICT');
      return regionSchema.parse(created);
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  async updateRegion(
    context: StaffAuthorizationContext,
    id: string,
    raw: UpdateRegionRequest,
  ) {
    if (!canAccessRegion(context, id)) throw new StoreNetworkError('SCOPE_MISMATCH');
    const input = updateRegionRequestSchema.parse(raw);
    const [updated] = await this.db
      .update(regions)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(regions.id, id))
      .returning();
    if (!updated) throw new StoreNetworkError('NOT_FOUND');
    return regionSchema.parse(updated);
  }

  async createFranchisee(context: StaffAuthorizationContext, raw: CreateFranchiseeRequest) {
    const input = createFranchiseeRequestSchema.parse(raw);
    await this.requireRegionExists(input.regionId);
    if (!canAccessRegion(context, input.regionId)) throw new StoreNetworkError('SCOPE_MISMATCH');
    try {
      const [created] = await this.db.insert(franchisees).values(input).returning();
      if (!created) throw new StoreNetworkError('CONFLICT');
      return franchiseeSchema.parse(created);
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  async updateFranchisee(
    context: StaffAuthorizationContext,
    id: string,
    raw: UpdateFranchiseeRequest,
  ) {
    const current = await this.requireFranchisee(id);
    if (!canAccessFranchisee(context, current)) throw new StoreNetworkError('SCOPE_MISMATCH');
    const input = updateFranchiseeRequestSchema.parse(raw);
    const [updated] = await this.db
      .update(franchisees)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(franchisees.id, id))
      .returning();
    if (!updated) throw new StoreNetworkError('NOT_FOUND');
    return franchiseeSchema.parse(updated);
  }

  async createStore(context: StaffAuthorizationContext, raw: CreateStoreRequest) {
    const input = createStoreRequestSchema.parse(raw);
    await this.requireRegionExists(input.regionId);
    const franchisee = input.franchiseeId ? await this.requireFranchisee(input.franchiseeId) : null;
    if (franchisee && franchisee.regionId !== input.regionId) {
      throw new StoreNetworkError('SCOPE_MISMATCH');
    }
    if (!canCreateStore(context, input.regionId, franchisee?.id ?? null)) {
      throw new StoreNetworkError('SCOPE_MISMATCH');
    }
    try {
      const [created] = await this.db
        .insert(stores)
        .values({ ...input, franchiseeId: input.franchiseeId ?? null })
        .returning({ id: stores.id });
      if (!created) throw new StoreNetworkError('CONFLICT');
      return await this.getStaffStore(created.id, context);
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  async updateStore(context: StaffAuthorizationContext, id: string, raw: UpdateStoreRequest) {
    const current = await this.requireStaffStoreRow(id);
    if (!canAccessStore(context, current)) throw new StoreNetworkError('SCOPE_MISMATCH');
    const input = updateStoreRequestSchema.parse(raw);
    const [updated] = await this.db
      .update(stores)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(stores.id, id))
      .returning({ id: stores.id });
    if (!updated) throw new StoreNetworkError('NOT_FOUND');
    return await this.getStaffStore(id, context);
  }

  async getStaffStore(id: string, context: StaffAuthorizationContext) {
    const row = await this.requireStaffStoreRow(id);
    if (!canAccessStore(context, row)) throw new StoreNetworkError('SCOPE_MISMATCH');
    return toStaffStore(row);
  }

  private async loadStaffStoreRows() {
    return await this.db
      .select({
        id: stores.id,
        code: stores.code,
        name: stores.name,
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
        operationalStatus: stores.operationalStatus,
        regionId: regions.id,
        regionCode: regions.code,
        regionName: regions.name,
        regionCountryCode: regions.countryCode,
        regionCountryName: regions.countryName,
        franchiseeId: franchisees.id,
        franchiseeCode: franchisees.code,
        franchiseeName: franchisees.name,
        franchiseeRegionId: franchisees.regionId,
      })
      .from(stores)
      .innerJoin(regions, eq(stores.regionId, regions.id))
      .leftJoin(franchisees, eq(stores.franchiseeId, franchisees.id))
      .orderBy(asc(stores.name));
  }

  private async requireStaffStoreRow(id: string) {
    const rows = await this.loadStaffStoreRows();
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) throw new StoreNetworkError('NOT_FOUND');
    return row;
  }

  private async requireRegionExists(id: string) {
    const [row] = await this.db.select({ id: regions.id }).from(regions).where(eq(regions.id, id)).limit(1);
    if (!row) throw new StoreNetworkError('NOT_FOUND');
  }

  private async requireFranchisee(id: string) {
    const [row] = await this.db.select().from(franchisees).where(eq(franchisees.id, id)).limit(1);
    if (!row) throw new StoreNetworkError('NOT_FOUND');
    return row;
  }
}

type StaffStoreRow = Awaited<ReturnType<StoreNetworkService['loadStaffStoreRows']>>[number];
type FranchiseeRow = Awaited<ReturnType<StoreNetworkService['requireFranchisee']>>;

function toStaffStore(row: StaffStoreRow) {
  return staffStoreSchema.parse({
    id: row.id,
    code: row.code,
    name: row.name,
    region: {
      id: row.regionId,
      code: row.regionCode,
      name: row.regionName,
      countryCode: row.regionCountryCode,
      countryName: row.regionCountryName,
    },
    franchisee: row.franchiseeId
      ? {
          id: row.franchiseeId,
          code: row.franchiseeCode,
          name: row.franchiseeName,
          regionId: row.franchiseeRegionId,
        }
      : null,
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
    operationalStatus: row.operationalStatus,
    distanceKm: null,
  });
}

function normalizeServices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function hasGlobal(context: StaffAuthorizationContext) {
  return context.dataScopes.some((scope) => scope.type === 'GLOBAL');
}
function hasScope(context: StaffAuthorizationContext, type: 'REGION' | 'FRANCHISEE' | 'STORE', id: string) {
  return context.dataScopes.some((scope) => scope.type === type && scope.id === id);
}
function canAccessRegion(context: StaffAuthorizationContext, regionId: string) {
  return hasGlobal(context) || hasScope(context, 'REGION', regionId);
}
function canAccessFranchisee(context: StaffAuthorizationContext, row: FranchiseeRow) {
  return (
    hasGlobal(context) ||
    hasScope(context, 'REGION', row.regionId) ||
    hasScope(context, 'FRANCHISEE', row.id)
  );
}
function canAccessStore(context: StaffAuthorizationContext, row: StaffStoreRow) {
  return (
    hasGlobal(context) ||
    hasScope(context, 'REGION', row.regionId) ||
    (row.franchiseeId !== null && hasScope(context, 'FRANCHISEE', row.franchiseeId)) ||
    hasScope(context, 'STORE', row.id)
  );
}
function canCreateStore(
  context: StaffAuthorizationContext,
  regionId: string,
  franchiseeId: string | null,
) {
  return (
    hasGlobal(context) ||
    hasScope(context, 'REGION', regionId) ||
    (franchiseeId !== null && hasScope(context, 'FRANCHISEE', franchiseeId))
  );
}

function translateWriteError(error: unknown): Error {
  if (error instanceof StoreNetworkError) return error;
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  ) {
    return new StoreNetworkError('CONFLICT');
  }
  return error instanceof Error ? error : new Error('Store network write failed');
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLatitude = toRadians(lat2 - lat1);
  const deltaLongitude = toRadians(lon2 - lon1);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(deltaLongitude / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
