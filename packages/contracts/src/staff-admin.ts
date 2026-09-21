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

export const staffAdminCreateAccountSchema = z
  .object({
    loginIdentifier: z.string().trim().min(3).max(120),
    password: z.string().min(12).max(128),
    enabled: z.boolean().default(true),
  })
  .strict();

export const staffAdminSetEnabledSchema = z.object({ enabled: z.boolean() }).strict();

export const staffAdminResetPasswordSchema = z
  .object({ password: z.string().min(12).max(128) })
  .strict();

export const staffAdminReplaceRolesSchema = z
  .object({ roleIds: z.array(z.uuid()).max(32) })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.roleIds).size !== value.roleIds.length) {
      context.addIssue({ code: 'custom', message: 'Duplicate role IDs are not allowed' });
    }
  });

export const staffAdminReplaceDataScopesSchema = z
  .object({ dataScopes: z.array(staffAdminDataScopeSchema).max(64) })
  .strict()
  .superRefine((value, context) => {
    const keys = value.dataScopes.map((scope) => `${scope.type}:${scope.id ?? ''}`);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: 'custom', message: 'Duplicate data scopes are not allowed' });
    }
    const globalScopes = value.dataScopes.filter((scope) => scope.type === 'GLOBAL');
    if (globalScopes.some((scope) => scope.id !== null)) {
      context.addIssue({ code: 'custom', message: 'GLOBAL scope cannot have an ID' });
    }
    if (value.dataScopes.some((scope) => scope.type !== 'GLOBAL' && scope.id === null)) {
      context.addIssue({ code: 'custom', message: 'Scoped access requires an ID' });
    }
    if (globalScopes.length > 0 && value.dataScopes.length > 1) {
      context.addIssue({
        code: 'custom',
        message: 'GLOBAL scope cannot be combined with other scopes',
      });
    }
  });

export const staffAdminOkSchema = z.object({ ok: z.literal(true) });

export type StaffAdminListQuery = z.infer<typeof staffAdminListQuerySchema>;
export type StaffAdminAccount = z.infer<typeof staffAdminAccountSchema>;
export type StaffAdminPermission = z.infer<typeof staffAdminPermissionSchema>;
export type StaffAdminRole = z.infer<typeof staffAdminRoleSchema>;
export type StaffAdminCreateAccount = z.infer<typeof staffAdminCreateAccountSchema>;
export type StaffAdminSetEnabled = z.infer<typeof staffAdminSetEnabledSchema>;
export type StaffAdminResetPassword = z.infer<typeof staffAdminResetPasswordSchema>;
export type StaffAdminReplaceRoles = z.infer<typeof staffAdminReplaceRolesSchema>;
export type StaffAdminReplaceDataScopes = z.infer<typeof staffAdminReplaceDataScopesSchema>;
