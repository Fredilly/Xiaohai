import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { AuditLogListQuery } from '@xiaohai/contracts/audit';
import { auditLogs, type createDatabase } from '@xiaohai/db';

type Database = ReturnType<typeof createDatabase>['db'];

export class AuditService {
  constructor(private readonly db: Database) {}

  async list(input: AuditLogListQuery) {
    const rows = await this.db
      .select({
        id: auditLogs.id,
        actorStaffAccountId: auditLogs.actorStaffAccountId,
        actionKey: auditLogs.actionKey,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        requestId: auditLogs.requestId,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(
        and(
          input.actorStaffAccountId
            ? eq(auditLogs.actorStaffAccountId, input.actorStaffAccountId)
            : undefined,
          input.actionKey ? eq(auditLogs.actionKey, input.actionKey) : undefined,
          input.resourceType ? eq(auditLogs.resourceType, input.resourceType) : undefined,
          input.resourceId ? eq(auditLogs.resourceId, input.resourceId) : undefined,
          input.requestId ? eq(auditLogs.requestId, input.requestId) : undefined,
          input.createdFrom ? gte(auditLogs.createdAt, new Date(input.createdFrom)) : undefined,
          input.createdTo ? lte(auditLogs.createdAt, new Date(input.createdTo)) : undefined,
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(input.limit);

    return {
      items: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}
