import { describe, expect, it } from 'vitest';
import {
  addCartItemRequestSchema,
  adminProductInputSchema,
  adminProductUpdateInputSchema,
  adminProductUpdateSchema,
  createOrderRequestSchema,
  orderStatusSchema,
  storeCatalogEditRequestSchema,
} from './commerce.js';
describe('M5 commerce contracts', () => {
  it('rejects invalid cart quantities', () => {
    expect(
      addCartItemRequestSchema.safeParse({
        skuId: '11111111-1111-4111-8111-111111111111',
        quantity: 0,
      }).success,
    ).toBe(false);
    expect(
      addCartItemRequestSchema.safeParse({
        skuId: '11111111-1111-4111-8111-111111111111',
        quantity: 100,
      }).success,
    ).toBe(false);
  });
  it('uses explicit order states', () => {
    expect(orderStatusSchema.safeParse('WHATEVER').success).toBe(false);
    expect(orderStatusSchema.parse('UNPAID')).toBe('UNPAID');
  });
  it('does not accept client price or total on order creation', () => {
    expect(
      createOrderRequestSchema.safeParse({
        addressId: '11111111-1111-4111-8111-111111111111',
        clientRequestId: 'request-123',
        totalMinor: 1,
      }).success,
    ).toBe(false);
  });
  it('requires integer minor-unit admin price', () => {
    expect(
      adminProductInputSchema.safeParse({
        name: 'Book',
        status: 'ACTIVE',
        book: null,
        sku: { code: 'A', name: 'A', priceMinor: 12.5, status: 'ACTIVE', availableForSale: true },
      }).success,
    ).toBe(false);
  });

  it('requires caller-supplied versions on legacy HQ updates', () => {
    const product = {
      name: 'Book',
      status: 'ACTIVE' as const,
      book: null,
      sku: {
        code: 'A',
        name: 'A',
        priceMinor: 1200,
        status: 'ACTIVE' as const,
        availableForSale: true,
      },
    };
    // Creating a new product has no previous versions.
    expect(adminProductInputSchema.safeParse(product).success).toBe(true);
    expect(adminProductUpdateSchema.safeParse(product).success).toBe(false);
    expect(
      adminProductUpdateSchema.safeParse({
        ...product,
        expectedProductVersion: 1,
        expectedSkuVersion: 0,
      }).success,
    ).toBe(true);
  });

  it('separates create and update version contracts', () => {
    const base = {
      name: 'Book',
      status: 'ACTIVE' as const,
      book: null,
      sku: {
        code: 'A',
        name: 'A',
        priceMinor: 1200,
        status: 'ACTIVE' as const,
        availableForSale: true,
      },
    };
    expect(adminProductUpdateInputSchema.safeParse(base).success).toBe(false);
    expect(
      adminProductUpdateInputSchema.safeParse({ ...base, expectedProductVersion: 0 }).success,
    ).toBe(false);
    expect(
      adminProductUpdateInputSchema.safeParse({ ...base, expectedSkuVersion: 0 }).success,
    ).toBe(false);
    expect(
      adminProductUpdateInputSchema.safeParse({
        ...base,
        expectedProductVersion: 0,
        expectedSkuVersion: 0,
      }).success,
    ).toBe(true);
  });

  it('allows the server to generate an internal SKU code on book creation', () => {
    const input = {
      name: 'Book',
      status: 'DRAFT' as const,
      book: { title: 'Book', author: 'Author', isbn: '9781234567890', publisher: null },
      sku: { name: '标准', priceMinor: 3980, status: 'ACTIVE' as const, availableForSale: false },
    };
    expect(adminProductInputSchema.safeParse(input).success).toBe(true);
    expect(adminProductUpdateInputSchema.safeParse(input).success).toBe(false);
  });

  it('requires optimistic-lock versions and validates direct catalog edits', () => {
    const base = {
      expectedProductVersion: 0,
      expectedBookVersion: 0,
      expectedEditionVersion: 0,
      expectedSkuVersion: 0,
      expectedLocalVersion: 0,
    };
    expect(storeCatalogEditRequestSchema.safeParse({ ...base, storeNote: 'Shelf A' }).success).toBe(
      true,
    );
    expect(storeCatalogEditRequestSchema.safeParse({ ...base, priceMinor: 1.5 }).success).toBe(
      false,
    );
    expect(storeCatalogEditRequestSchema.safeParse(base).success).toBe(false);
  });

  it('normalizes ISBN separators consistently while preserving explicit null', () => {
    const base = {
      name: 'Book',
      status: 'ACTIVE' as const,
      book: {
        title: 'Title',
        author: 'Author',
        isbn: '978-1 2345-67890',
        publisher: null,
      },
      sku: {
        code: 'ISBN-1',
        name: 'Standard',
        priceMinor: 100,
        status: 'ACTIVE' as const,
        availableForSale: true,
      },
    };
    expect(adminProductInputSchema.parse(base).book?.isbn).toBe('9781234567890');
    expect(
      storeCatalogEditRequestSchema.parse({
        expectedProductVersion: 0,
        expectedSkuVersion: 0,
        expectedLocalVersion: 0,
        expectedBookVersion: 0,
        expectedEditionVersion: 0,
        isbn: '978-1 2345-67890',
      }).isbn,
    ).toBe('9781234567890');
    expect(
      storeCatalogEditRequestSchema.parse({
        expectedProductVersion: 0,
        expectedSkuVersion: 0,
        expectedLocalVersion: 0,
        expectedEditionVersion: 0,
        isbn: '',
      }).isbn,
    ).toBeNull();
  });
});
