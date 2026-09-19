import { z } from 'zod';

const staffDataScopeTypeSchema = z.enum(['GLOBAL', 'REGION', 'FRANCHISEE', 'STORE']);

export const staffAdminListQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(120).optional(),
    enabled: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export const staffAdminRoleSummarySchema = z.object({
  id: z.uuid(),
  key: z.string(),
  displayName: z.string(),
});

export const staffAdminDataScopeSchema = z.object({
  type: staffDataScopeTypeSchema,
  id: z.uuid().nullable(),
});

export const staffAdminAccountSchema = z.object({
  id: z.uuid(),
  loginIdentifier: z.string(),
  enabled: z.boolean(),
  roles: z.array(staffAdminRoleSummarySchema),
  dataScopes: z.array(staffAdminDataScopeSchema),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const staffAdminListResponseSchema = z.object({
  items: z.array(staffAdminAccountSchema),
});

export const staffAdminPermissionSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
});

export const staffAdminPermissionsResponseSchema = z.object({
  items: z.array(staffAdminPermissionSchema),
});

export const staffAdminRoleSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  permissions: z.array(staffAdminPermissionSchema),
});

export const staffAdminRolesResponseSchema = z.object({ items: z.array(staffAdminRoleSchema) });

export type StaffAdminListQuery = z.infer<typeof staffAdminListQuerySchema>;
export type StaffAdminAccount = z.infer<typeof staffAdminAccountSchema>;
export type StaffAdminPermission = z.infer<typeof staffAdminPermissionSchema>;
export type StaffAdminRole = z.infer<typeof staffAdminRoleSchema>;
