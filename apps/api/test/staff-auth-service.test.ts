import { describe, expect, it, vi } from 'vitest';
import { StaffAuthService } from '../src/auth/staff-auth-service.js';
import type { PasswordHasher } from '../src/auth/password.js';
import type { StaffAccountRepository } from '../src/auth/staff-repository.js';
import { StaffSessionService } from '../src/auth/staff-session.js';

const staffId = '018f0f7f-17e7-7d50-8a4a-1cf31eb8105d';
const staff = {
  id: staffId,
  loginIdentifier: 'staff@example.com',
  passwordHash: 'encoded-password-hash',
  sessionVersion: 0,
  enabled: true,
};

function setup(account: typeof staff | null, passwordMatches: boolean) {
  const findByLoginIdentifier = vi.fn().mockResolvedValue(account);
  const recordSuccessfulLogin = vi.fn().mockResolvedValue(true);
  const repository: StaffAccountRepository = {
    findByLoginIdentifier,
    recordSuccessfulLogin,
  };
  const passwordHasher: PasswordHasher = {
    hash: vi.fn(),
    verify: vi.fn().mockResolvedValue(passwordMatches),
  };
  return {
    findByLoginIdentifier,
    recordSuccessfulLogin,
    passwordHasher,
    service: new StaffAuthService(
      repository,
      passwordHasher,
      new StaffSessionService('staff-test-session-secret-at-least-32-characters', 300),
      () => new Date('2026-01-01T00:00:00.000Z'),
    ),
  };
}

describe('staff authentication service', () => {
  it('logs in with normalized identifier and records last login', async () => {
    const { service, findByLoginIdentifier, recordSuccessfulLogin } = setup(staff, true);
    const result = await service.login(' STAFF@EXAMPLE.COM ', 'correct-password');
    expect(findByLoginIdentifier).toHaveBeenCalledWith('staff@example.com');
    expect(recordSuccessfulLogin).toHaveBeenCalledWith(
      staffId,
      new Date('2026-01-01T00:00:00.000Z'),
    );
    expect(result.staff).toEqual({ id: staffId, loginIdentifier: 'staff@example.com' });
  });

  it.each([
    ['wrong password', staff, false],
    ['missing account', null, false],
    ['disabled account', { ...staff, enabled: false }, true],
  ] as const)('returns the same failure for %s', async (_case, account, passwordMatches) => {
    const { service } = setup(account, passwordMatches);
    await expect(service.login('staff@example.com', 'candidate-password')).rejects.toMatchObject({
      code: 'STAFF_AUTHENTICATION_FAILED',
      statusCode: 401,
    });
  });
});
