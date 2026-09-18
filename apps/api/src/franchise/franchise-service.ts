import { randomUUID } from 'node:crypto';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import type {
  AssignFranchiseApplicationRequest,
  CreateFranchiseApplicationRequest,
  CreateFranchiseFollowupRequest,
  FranchiseApplicationListQuery,
  FranchiseApplicationStatus,
  ReviewFranchiseApplicationRequest,
  UpdateFranchiseApplicationStatusRequest,
} from '@xiaohai/contracts/franchise';
import {
  franchiseApplications,
  franchiseFollowups,
  staffAccounts,
  type createDatabase,
} from '@xiaohai/db';

type Database = ReturnType<typeof createDatabase>['db'];

export const franchisePermissions = {
  read: 'franchise.read',
  assign: 'franchise.assign',
  followup: 'franchise.followup',
  review: 'franchise.review',
  manage: 'franchise.manage',
} as const;

export type FranchiseErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'STALE_VERSION'
  | 'ASSIGNEE_INVALID';

export class FranchiseError extends Error {
  constructor(readonly code: FranchiseErrorCode) {
    super(code);
  }
}

export class FranchiseService {
  constructor(private readonly db: Database) {}

  async createApplication(
    input: CreateFranchiseApplicationRequest,
    consumerUserId: string | null,
  ) {
    const id = randomUUID();
    const applicationNumber = `FA-${Date.now()}-${id.slice(0, 8).toUpperCase()}`;
    const [row] = await this.db
      .insert(franchiseApplications)
      .values({
        id,
        applicationNumber,
        submittedByConsumerUserId: consumerUserId,
        name: input.name,
        phone: input.phone,
        email: input.email ?? null,
        country: input.country,
        region: input.region,
        city: input.city,
        district: input.district ?? null,
        background: input.background ?? null,
        message: input.message ?? null,
      })
      .returning({
        id: franchiseApplications.id,
        applicationNumber: franchiseApplications.applicationNumber,
        status: franchiseApplications.status,
        submittedAt: franchiseApplications.submittedAt,
      });
    if (!row) throw new FranchiseError('NOT_FOUND');
    return row;
  }

  async listApplications(query: FranchiseApplicationListQuery) {
    const keyword = query.query ? `%${query.query}%` : null;
    const rows = await this.db
      .select()
      .from(franchiseApplications)
      .where(
        and(
          query.status ? eq(franchiseApplications.status, query.status) : undefined,
          query.assignedStaffAccountId
            ? eq(franchiseApplications.assignedStaffAccountId, query.assignedStaffAccountId)
            : undefined,
          query.country ? eq(franchiseApplications.country, query.country) : undefined,
          query.region ? eq(franchiseApplications.region, query.region) : undefined,
          query.city ? eq(franchiseApplications.city, query.city) : undefined,
          keyword
            ? or(
                ilike(franchiseApplications.applicationNumber, keyword),
                ilike(franchiseApplications.name, keyword),
                ilike(franchiseApplications.phone, keyword),
                ilike(franchiseApplications.email, keyword),
              )
            : undefined,
        ),
      )
      .orderBy(desc(franchiseApplications.createdAt))
      .limit(query.limit);
    return { items: rows };
  }

  async getApplication(id: string) {
    const row = await this.loadApplication(id);
    if (!row) throw new FranchiseError('NOT_FOUND');
    const followups = await this.db
      .select()
      .from(franchiseFollowups)
      .where(eq(franchiseFollowups.franchiseApplicationId, id))
      .orderBy(franchiseFollowups.createdAt);
    return { ...row, followups };
  }

  async assign(id: string, input: AssignFranchiseApplicationRequest) {
    const [assignee] = await this.db
      .select({ id: staffAccounts.id, enabled: staffAccounts.enabled })
      .from(staffAccounts)
      .where(eq(staffAccounts.id, input.staffAccountId))
      .limit(1);
    if (!assignee?.enabled) throw new FranchiseError('ASSIGNEE_INVALID');

    const current = await this.requireApplication(id, input.version);
    if (!['SUBMITTED', 'ASSIGNED', 'FOLLOWING_UP'].includes(current.status)) {
      throw new FranchiseError('INVALID_STATE');
    }
    const now = new Date();
    const nextStatus = current.status === 'FOLLOWING_UP' ? 'FOLLOWING_UP' : 'ASSIGNED';
    await this.updateVersioned(id, input.version, {
      assignedStaffAccountId: input.staffAccountId,
      assignedAt: now,
      status: nextStatus,
      updatedAt: now,
    });
    return this.getApplication(id);
  }

  async addFollowup(
    id: string,
    staffAccountId: string,
    input: CreateFranchiseFollowupRequest,
  ) {
    const current = await this.requireApplication(id, input.version);
    if (!['ASSIGNED', 'FOLLOWING_UP'].includes(current.status)) {
      throw new FranchiseError('INVALID_STATE');
    }
    if (current.assignedStaffAccountId !== staffAccountId) {
      throw new FranchiseError('INVALID_STATE');
    }

    await this.db.transaction(async (tx) => {
      const now = new Date();
      const updated = await tx
        .update(franchiseApplications)
        .set({ status: 'FOLLOWING_UP', version: input.version + 1, updatedAt: now })
        .where(
          and(
            eq(franchiseApplications.id, id),
            eq(franchiseApplications.version, input.version),
          ),
        )
        .returning({ id: franchiseApplications.id });
      if (updated.length === 0) throw new FranchiseError('STALE_VERSION');
      await tx.insert(franchiseFollowups).values({
        franchiseApplicationId: id,
        staffAccountId,
        channel: input.channel,
        note: input.note,
        nextFollowupAt: input.nextFollowupAt ? new Date(input.nextFollowupAt) : null,
      });
    });
    return this.getApplication(id);
  }

  async review(
    id: string,
    staffAccountId: string,
    input: ReviewFranchiseApplicationRequest,
  ) {
    const current = await this.requireApplication(id, input.version);
    if (!['ASSIGNED', 'FOLLOWING_UP'].includes(current.status)) {
      throw new FranchiseError('INVALID_STATE');
    }
    const now = new Date();
    await this.updateVersioned(id, input.version, {
      status: input.decision,
      reviewedByStaffAccountId: staffAccountId,
      reviewNote: input.note ?? null,
      reviewedAt: now,
      approvedAt: input.decision === 'APPROVED' ? now : null,
      rejectedAt: input.decision === 'REJECTED' ? now : null,
      updatedAt: now,
    });
    return this.getApplication(id);
  }

  async updateStatus(id: string, input: UpdateFranchiseApplicationStatusRequest) {
    const current = await this.requireApplication(id, input.version);
    if (!canTransition(current.status as FranchiseApplicationStatus, input.status)) {
      throw new FranchiseError('INVALID_STATE');
    }
    const now = new Date();
    await this.updateVersioned(id, input.version, {
      status: input.status,
      signedAt: input.status === 'SIGNED' ? now : current.signedAt,
      preparingAt: input.status === 'PREPARING' ? now : current.preparingAt,
      openedAt: input.status === 'OPENED' ? now : current.openedAt,
      closedAt: input.status === 'CLOSED' ? now : current.closedAt,
      updatedAt: now,
    });
    return this.getApplication(id);
  }

  private async requireApplication(id: string, version: number) {
    const row = await this.loadApplication(id);
    if (!row) throw new FranchiseError('NOT_FOUND');
    if (row.version !== version) throw new FranchiseError('STALE_VERSION');
    return row;
  }

  private async loadApplication(id: string) {
    const [row] = await this.db
      .select()
      .from(franchiseApplications)
      .where(eq(franchiseApplications.id, id))
      .limit(1);
    return row ?? null;
  }

  private async updateVersioned(
    id: string,
    version: number,
    values: Partial<typeof franchiseApplications.$inferInsert>,
  ) {
    const updated = await this.db
      .update(franchiseApplications)
      .set({ ...values, version: version + 1 })
      .where(
        and(eq(franchiseApplications.id, id), eq(franchiseApplications.version, version)),
      )
      .returning({ id: franchiseApplications.id });
    if (updated.length === 0) throw new FranchiseError('STALE_VERSION');
  }
}

function canTransition(current: FranchiseApplicationStatus, target: FranchiseApplicationStatus) {
  if (target === 'CLOSED') {
    return ['SUBMITTED', 'ASSIGNED', 'FOLLOWING_UP', 'APPROVED', 'SIGNED', 'PREPARING', 'OPENED'].includes(
      current,
    );
  }
  return (
    (current === 'APPROVED' && target === 'SIGNED') ||
    (current === 'SIGNED' && target === 'PREPARING') ||
    (current === 'PREPARING' && target === 'OPENED')
  );
}
