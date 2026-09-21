import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const payloadSchema = z.object({
  v: z.literal(1),
  realm: z.literal('staff'),
  sid: z.uuid(),
  sv: z.number().int().nonnegative(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});

export interface StaffSessionClaims {
  staffAccountId: string;
  sessionVersion: number;
  issuedAt: Date;
  expiresAt: Date;
}

export class StaffSessionService {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (Buffer.byteLength(secret, 'utf8') < 32) {
      throw new Error('Staff session secret must contain at least 32 bytes');
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60) {
      throw new Error('Staff session TTL must be at least 60 seconds');
    }
  }

  issue(staffAccountId: string, sessionVersion = 0): { token: string; expiresAt: Date } {
    if (!Number.isInteger(sessionVersion) || sessionVersion < 0) {
      throw new Error('Staff session version must be a non-negative integer');
    }

    const issuedAt = Math.floor(this.now().getTime() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        realm: 'staff',
        sid: staffAccountId,
        sv: sessionVersion,
        iat: issuedAt,
        exp: issuedAt + this.ttlSeconds,
      }),
    ).toString('base64url');
    return {
      token: `${payload}.${this.sign(payload)}`,
      expiresAt: new Date((issuedAt + this.ttlSeconds) * 1000),
    };
  }

  verify(token: string): StaffSessionClaims | null {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return null;
    const expected = Buffer.from(this.sign(payload));
    const supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

    try {
      const claims = payloadSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
      if (claims.exp <= Math.floor(this.now().getTime() / 1000)) return null;
      return {
        staffAccountId: claims.sid,
        sessionVersion: claims.sv,
        issuedAt: new Date(claims.iat * 1000),
        expiresAt: new Date(claims.exp * 1000),
      };
    } catch {
      return null;
    }
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}
