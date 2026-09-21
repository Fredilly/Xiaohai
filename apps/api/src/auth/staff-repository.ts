import { and, eq } from 'drizzle-orm';
import { staffAccounts, type createDatabase } from '@xiaohai/db';

type Database = ReturnType<typeof createDatabase>['db'];

export interface StaffAccountRecord {
  id: string;
  loginIdentifier: string;
  passwordHash: string;
  sessionVersion: number;
  enabled: boolean;
}

export interface StaffAccountRepository {
  findByLoginIdentifier(loginIdentifier: string): Promise<StaffAccountRecord | null>;
  recordSuccessfulLogin(staffAccountId: string, loggedInAt: Date): Promise<boolean>;
}

export class DrizzleStaffAccountRepository implements StaffAccountRepository {
  constructor(private readonly db: Database) {}

  async findByLoginIdentifier(loginIdentifier: string): Promise<StaffAccountRecord | null> {
    const [staff] = await this.db
      .select({
        id: staffAccounts.id,
        loginIdentifier: staffAccounts.loginIdentifier,
        passwordHash: staffAccounts.passwordHash,
        sessionVersion: staffAccounts.sessionVersion,
        enabled: staffAccounts.enabled,
      })
      .from(staffAccounts)
      .where(eq(staffAccounts.loginIdentifier, loginIdentifier))
      .limit(1);
    return staff ?? null;
  }

  async recordSuccessfulLogin(staffAccountId: string, loggedInAt: Date): Promise<boolean> {
    const updated = await this.db
      .update(staffAccounts)
      .set({ lastLoginAt: loggedInAt, updatedAt: loggedInAt })
      .where(and(eq(staffAccounts.id, staffAccountId), eq(staffAccounts.enabled, true)))
      .returning({ id: staffAccounts.id });
    return updated.length === 1;
  }
}
