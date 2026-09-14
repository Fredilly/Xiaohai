import { describe, expect, it } from 'vitest';
import { ConsumerSessionService } from '../src/auth/session.js';
import { StaffSessionService } from '../src/auth/staff-session.js';

const accountId = '018f0f7f-17e7-7d50-8a4a-1cf31eb8105d';
const sharedSecretForIsolationTest = 'test-shared-secret-still-realm-isolated-123456';

describe('staff session', () => {
  it('verifies a valid staff session and rejects it at expiry', () => {
    let now = new Date('2026-01-01T00:00:00.000Z');
    const service = new StaffSessionService(sharedSecretForIsolationTest, 60, () => now);
    const issued = service.issue(accountId);
    expect(service.verify(issued.token)?.staffAccountId).toBe(accountId);
    now = new Date('2026-01-01T00:01:00.000Z');
    expect(service.verify(issued.token)).toBeNull();
  });

  it('keeps consumer and staff tokens isolated even if secrets are misconfigured equally', () => {
    const staff = new StaffSessionService(sharedSecretForIsolationTest, 300);
    const consumer = new ConsumerSessionService(sharedSecretForIsolationTest, 300);
    const staffToken = staff.issue(accountId).token;
    const consumerToken = consumer.issue(accountId).token;
    expect(consumer.verify(staffToken)).toBeNull();
    expect(staff.verify(consumerToken)).toBeNull();
  });
});
