import { describe, expect, it, vi } from 'vitest';
import { FoodReservationService } from '../src/inventory/food-reservation-service.js';

describe('food reservation default-deny boundary', () => {
  it('refuses reserve and release before reaching any database transaction', async () => {
    const transaction = vi.fn();
    const service = new FoodReservationService({ transaction } as unknown as ConstructorParameters<
      typeof FoodReservationService
    >[0]);
    await expect(service.reserve('order-item', 'store')).rejects.toMatchObject({
      code: 'WRITES_DISABLED',
    });
    await expect(service.release('order-item', 'store')).rejects.toMatchObject({
      code: 'WRITES_DISABLED',
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
