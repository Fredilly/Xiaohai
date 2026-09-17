import { z } from 'zod';
import { moneyMinorSchema } from './commerce.js';
import { publicStoreSchema } from './stores.js';

export const inventoryAvailabilitySchema = z.enum(['ANY', 'SALE', 'RENT']);

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

export const publicInventoryQuerySchema = z
  .object({
    q: optionalQueryText,
    availability: z.preprocess(
      (value) => (value === '' || value === undefined ? undefined : value),
      inventoryAvailabilitySchema.optional(),
    ),
    storeId: optionalUuid,
    regionId: optionalUuid,
    city: optionalQueryText,
    latitude: optionalNumber(z.number().min(-90).max(90)),
    longitude: optionalNumber(z.number().min(-180).max(180)),
    radiusKm: optionalNumber(z.number().positive().max(200)),
    limit: optionalNumber(z.number().int().min(1).max(100)),
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

export const publicInventoryItemSchema = z.object({
  book: z.object({
    id: z.uuid(),
    title: z.string(),
    author: z.string(),
    isbn: z.string().nullable(),
    publisher: z.string().nullable(),
  }),
  product: z.object({
    id: z.uuid(),
    name: z.string(),
    coverUrl: z.string().nullable(),
  }),
  sku: z.object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    priceMinor: moneyMinorSchema,
  }),
  store: publicStoreSchema,
  stock: z.object({
    onHand: z.number().int().nonnegative(),
    reserved: z.number().int().nonnegative(),
    rentalReserved: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
  }),
  sellAvailable: z.boolean(),
  rentAvailable: z.boolean(),
});

export const publicInventorySearchResponseSchema = z.object({
  items: z.array(publicInventoryItemSchema),
});

export type InventoryAvailability = z.infer<typeof inventoryAvailabilitySchema>;
export type PublicInventoryQuery = z.infer<typeof publicInventoryQuerySchema>;
export type PublicInventoryItem = z.infer<typeof publicInventoryItemSchema>;
