import { z } from 'zod';

export const storeOperationalStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const regionSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  countryCode: z.string(),
  countryName: z.string(),
  operationalStatus: storeOperationalStatusSchema,
  displayOrder: z.number().int(),
});

export const publicRegionSchema = regionSchema.pick({
  id: true,
  code: true,
  name: true,
  countryCode: true,
  countryName: true,
});

export const franchiseeSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  regionId: z.uuid(),
  name: z.string(),
  operationalStatus: storeOperationalStatusSchema,
});

export const publicStoreSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  region: publicRegionSchema,
  countryCode: z.string(),
  countryName: z.string(),
  city: z.string(),
  timezone: z.string(),
  addressLine: z.string(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  phone: z.string().nullable(),
  openingHoursText: z.string().nullable(),
  services: z.array(z.string()),
  distanceKm: z.number().nonnegative().nullable().optional(),
});

export const staffStoreSchema = publicStoreSchema.extend({
  franchisee: franchiseeSchema
    .pick({ id: true, code: true, name: true, regionId: true })
    .nullable(),
  operationalStatus: storeOperationalStatusSchema,
});

const queryText = z.string().trim().min(1).max(120);
const optionalQueryText = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  queryText.optional(),
);
const optionalUuid = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.uuid().optional(),
);
const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.coerce.number().pipe(schema).optional(),
  );

export const publicStoreQuerySchema = z
  .object({
    q: optionalQueryText,
    country: optionalQueryText,
    city: optionalQueryText,
    regionId: optionalUuid,
    service: optionalQueryText,
    latitude: optionalNumber(z.number().min(-90).max(90)),
    longitude: optionalNumber(z.number().min(-180).max(180)),
    radiusKm: optionalNumber(z.number().positive().max(200)),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasLatitude = value.latitude !== undefined;
    const hasLongitude = value.longitude !== undefined;
    if (hasLatitude !== hasLongitude) {
      ctx.addIssue({
        code: 'custom',
        message: 'latitude and longitude must be provided together',
      });
    }
    if (value.radiusKm !== undefined && (!hasLatitude || !hasLongitude)) {
      ctx.addIssue({ code: 'custom', message: 'radiusKm requires latitude and longitude' });
    }
  });

const codeSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const nameSchema = z.string().trim().min(1).max(160);
const countryCodeSchema = z.string().trim().min(2).max(8).transform((value) => value.toUpperCase());

export const createRegionRequestSchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
    countryCode: countryCodeSchema,
    countryName: nameSchema,
    operationalStatus: storeOperationalStatusSchema.default('ACTIVE'),
    displayOrder: z.number().int().min(0).max(100000).default(0),
  })
  .strict();

export const updateRegionRequestSchema = z
  .object({
    name: nameSchema.optional(),
    countryCode: countryCodeSchema.optional(),
    countryName: nameSchema.optional(),
    operationalStatus: storeOperationalStatusSchema.optional(),
    displayOrder: z.number().int().min(0).max(100000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

export const createFranchiseeRequestSchema = z
  .object({
    code: codeSchema,
    regionId: z.uuid(),
    name: nameSchema,
    operationalStatus: storeOperationalStatusSchema.default('ACTIVE'),
  })
  .strict();

export const updateFranchiseeRequestSchema = z
  .object({
    name: nameSchema.optional(),
    operationalStatus: storeOperationalStatusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

const serviceSchema = z.string().trim().min(1).max(80);
export const createStoreRequestSchema = z
  .object({
    code: codeSchema,
    regionId: z.uuid(),
    franchiseeId: z.uuid().nullable().optional(),
    name: nameSchema,
    countryCode: countryCodeSchema,
    countryName: nameSchema,
    city: nameSchema,
    timezone: z.string().trim().min(1).max(80),
    addressLine: z.string().trim().min(1).max(500),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    phone: z.string().trim().max(80).nullable().optional(),
    openingHoursText: z.string().trim().max(500).nullable().optional(),
    services: z.array(serviceSchema).max(30).default([]),
    operationalStatus: storeOperationalStatusSchema.default('ACTIVE'),
  })
  .strict();

export const updateStoreRequestSchema = z
  .object({
    name: nameSchema.optional(),
    countryCode: countryCodeSchema.optional(),
    countryName: nameSchema.optional(),
    city: nameSchema.optional(),
    timezone: z.string().trim().min(1).max(80).optional(),
    addressLine: z.string().trim().min(1).max(500).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    phone: z.string().trim().max(80).nullable().optional(),
    openingHoursText: z.string().trim().max(500).nullable().optional(),
    services: z.array(serviceSchema).max(30).optional(),
    operationalStatus: storeOperationalStatusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

export const publicRegionsResponseSchema = z.object({ regions: z.array(publicRegionSchema) });
export const publicStoresResponseSchema = z.object({ stores: z.array(publicStoreSchema) });
export const staffStoresResponseSchema = z.object({ stores: z.array(staffStoreSchema) });

export type StoreOperationalStatus = z.infer<typeof storeOperationalStatusSchema>;
export type Region = z.infer<typeof regionSchema>;
export type PublicRegion = z.infer<typeof publicRegionSchema>;
export type Franchisee = z.infer<typeof franchiseeSchema>;
export type PublicStore = z.infer<typeof publicStoreSchema>;
export type StaffStore = z.infer<typeof staffStoreSchema>;
export type PublicStoreQuery = z.infer<typeof publicStoreQuerySchema>;
export type CreateRegionRequest = z.infer<typeof createRegionRequestSchema>;
export type UpdateRegionRequest = z.infer<typeof updateRegionRequestSchema>;
export type CreateFranchiseeRequest = z.infer<typeof createFranchiseeRequestSchema>;
export type UpdateFranchiseeRequest = z.infer<typeof updateFranchiseeRequestSchema>;
export type CreateStoreRequest = z.infer<typeof createStoreRequestSchema>;
export type UpdateStoreRequest = z.infer<typeof updateStoreRequestSchema>;
