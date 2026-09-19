import { z } from 'zod';

export const auditLogSchema = z.object({
  id: z.uuid(),
  actorStaffAccountId: z.uuid(),
  actionKey: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  requestId: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});

export const auditLogListQuerySchema = z
  .object({
    actorStaffAccountId: z.uuid().optional(),
    actionKey: z.string().trim().min(1).max(128).optional(),
    resourceType: z.string().trim().min(1).max(128).optional(),
    resourceId: z.string().trim().min(1).max(200).optional(),
    requestId: z.string().trim().min(1).max(200).optional(),
    createdFrom: z.iso.datetime().optional(),
    createdTo: z.iso.datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.createdFrom &&
      value.createdTo &&
      new Date(value.createdFrom).getTime() > new Date(value.createdTo).getTime()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['createdTo'],
        message: 'createdTo must not be earlier than createdFrom',
      });
    }
  });

export const auditLogListResponseSchema = z.object({ items: z.array(auditLogSchema) });

export type AuditLog = z.infer<typeof auditLogSchema>;
export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>;
export type AuditLogListResponse = z.infer<typeof auditLogListResponseSchema>;
