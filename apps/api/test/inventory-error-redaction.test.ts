import { buildApp } from '../src/app.js';
import pino from 'pino';
import { describe, it, expect, vi } from 'vitest';
import { registerInventoryOperationsRoutes } from '../src/inventory/inventory-operations-routes.js';
import type { InventoryOperationsService } from '../src/inventory/inventory-operations-service.js';
import type { StaffAuthorizationService } from '../src/auth/staff-authorization.js';
describe('inventory transfer error boundary', () => {
  it('never serializes raw SQL/DSN/evidence errors to logs or response', async () => {
    const logs: string[] = [];
    const app = buildApp({
      loggerInstance: pino(
        { level: 'error' },
        {
          write: (line: string) => {
            logs.push(line);
          },
        },
      ),
    });
    registerInventoryOperationsRoutes(app, {
      operations: {
        actOnTransfer: vi
          .fn()
          .mockRejectedValue(
            new Error('postgresql://synthetic:secret@private/db?signature=opaque'),
          ),
      } as unknown as InventoryOperationsService,
      staffAuthorization: {
        authenticate: vi.fn().mockResolvedValue({}),
        requirePermission: vi.fn(),
      } as unknown as StaffAuthorizationService,
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/staff/inventory/transfers/11111111-1111-4111-8111-111111111111/actions',
        payload: { action: 'DISPATCH' },
      });
      expect(response.statusCode).toBe(500);
      expect(logs.join('') + response.body).not.toMatch(/postgresql|signature|secret|opaque/);
      expect(logs.join('')).toContain('INVENTORY_OPERATION_FAILED');
    } finally {
      await app.close();
    }
  });
});
