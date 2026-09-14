import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, staffAccounts } from '@xiaohai/db';
import { ScryptPasswordHasher } from '../src/auth/password.js';
import { StaffAuthService, normalizeStaffLoginIdentifier } from '../src/auth/staff-auth-service.js';
import { DrizzleStaffAccountRepository } from '../src/auth/staff-repository.js';
import { StaffSessionService } from '../src/auth/staff-session.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const database = hasDatabase ? createDatabase(process.env) : null;
const testSuite = hasDatabase ? describe : describe.skip;

testSuite('staff authentication PostgreSQL integration', () => {
  const hasher = new ScryptPasswordHasher();
  const sessions = new StaffSessionService(
    'staff-integration-session-secret-at-least-32-characters',
    300,
  );

  beforeEach(async () => database!.db.delete(staffAccounts));
  afterAll(async () => database?.pool.end());

  it('stores a non-plaintext hash, logs in, and updates last_login_at', async () => {
    const password = 'correct-horse-battery-staple';
    const passwordHash = await hasher.hash(password);
    const [created] = await database!.db
      .insert(staffAccounts)
      .values({
        loginIdentifier: normalizeStaffLoginIdentifier('Staff.One@Example.com'),
        passwordHash,
      })
      .returning({ id: staffAccounts.id, passwordHash: staffAccounts.passwordHash });
    expect(created!.passwordHash).not.toBe(password);
    expect(created!.passwordHash).not.toContain(password);

    const service = new StaffAuthService(
      new DrizzleStaffAccountRepository(database!.db),
      hasher,
      sessions,
      () => new Date('2026-01-01T12:00:00.000Z'),
    );
    const result = await service.login(' STAFF.ONE@example.com ', password);
    expect(result.staff.id).toBe(created!.id);
    expect(sessions.verify(result.session.token)?.staffAccountId).toBe(created!.id);

    const [updated] = await database!.db
      .select({ lastLoginAt: staffAccounts.lastLoginAt })
      .from(staffAccounts)
      .where(eq(staffAccounts.id, created!.id));
    expect(updated!.lastLoginAt?.toISOString()).toBe('2026-01-01T12:00:00.000Z');
  });

  it('rejects wrong passwords, unknown identifiers, and disabled accounts identically', async () => {
    const passwordHash = await hasher.hash('correct-password');
    await database!.db.insert(staffAccounts).values([
      { loginIdentifier: 'enabled@example.com', passwordHash },
      { loginIdentifier: 'disabled@example.com', passwordHash, enabled: false },
    ]);
    const service = new StaffAuthService(
      new DrizzleStaffAccountRepository(database!.db),
      hasher,
      sessions,
    );

    for (const [identifier, password] of [
      ['enabled@example.com', 'wrong-password'],
      ['missing@example.com', 'wrong-password'],
      ['disabled@example.com', 'correct-password'],
    ]) {
      await expect(service.login(identifier!, password!)).rejects.toMatchObject({
        code: 'STAFF_AUTHENTICATION_FAILED',
        statusCode: 401,
      });
    }
  });
});
