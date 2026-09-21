import type { StaffLoginResponse } from '@xiaohai/contracts';
import { ConsumerAuthError } from './errors.js';
import type { PasswordHasher } from './password.js';
import type { StaffAccountRepository } from './staff-repository.js';
import type { StaffSessionService } from './staff-session.js';

const dummyPasswordHash =
  'scrypt$16384$8$1$ASNFZ4mrze8BI0VniavN7w$FsYXIXejf8wIlTzYFOkZfxwgmfYZSXHB8wMGyEk0ydP7U5WNxh1fdbvh4u_AGhztNwfMUbBIhgyLMylf4T5EAg';

export function normalizeStaffLoginIdentifier(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

export class StaffAuthService {
  constructor(
    private readonly repository: StaffAccountRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly sessions: StaffSessionService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async login(loginIdentifier: string, password: string): Promise<StaffLoginResponse> {
    const normalizedIdentifier = normalizeStaffLoginIdentifier(loginIdentifier);
    const staff = await this.repository.findByLoginIdentifier(normalizedIdentifier);
    const passwordMatches = await this.passwordHasher.verify(
      password,
      staff?.passwordHash ?? dummyPasswordHash,
    );

    if (!staff || !passwordMatches || !staff.enabled) {
      throw new ConsumerAuthError('STAFF_AUTHENTICATION_FAILED', 401);
    }

    const loggedInAt = this.now();
    if (!(await this.repository.recordSuccessfulLogin(staff.id, loggedInAt))) {
      throw new ConsumerAuthError('STAFF_AUTHENTICATION_FAILED', 401);
    }
    const session = this.sessions.issue(staff.id, staff.sessionVersion);
    return {
      staff: { id: staff.id, loginIdentifier: staff.loginIdentifier },
      session: { token: session.token, expiresAt: session.expiresAt.toISOString() },
    };
  }
}
