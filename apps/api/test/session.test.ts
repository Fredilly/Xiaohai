import { describe, expect, it } from 'vitest';
import { ConsumerSessionService } from '../src/auth/session.js';

const userId = '018f0f7f-17e7-7d50-8a4a-1cf31eb8105b';
const secret = 'test-only-session-secret-at-least-32-characters';

describe('consumer session', () => {
  it('issues and verifies a valid session', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const service = new ConsumerSessionService(secret, 300, () => now);
    const issued = service.issue(userId);
    expect(service.verify(issued.token)?.consumerUserId).toBe(userId);
    expect(issued.expiresAt.toISOString()).toBe('2026-01-01T00:05:00.000Z');
  });

  it('rejects an expired session', () => {
    let now = new Date('2026-01-01T00:00:00.000Z');
    const service = new ConsumerSessionService(secret, 60, () => now);
    const issued = service.issue(userId);
    now = new Date('2026-01-01T00:01:00.000Z');
    expect(service.verify(issued.token)).toBeNull();
  });

  it('rejects a modified or malformed session', () => {
    const service = new ConsumerSessionService(secret, 60);
    const issued = service.issue(userId);
    expect(service.verify(`${issued.token}changed`)).toBeNull();
    expect(service.verify('not-a-session')).toBeNull();
  });
});
