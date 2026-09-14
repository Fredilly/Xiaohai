import { describe, expect, it } from 'vitest';
import { ScryptPasswordHasher } from '../src/auth/password.js';

describe('staff password hashing', () => {
  it('creates salted, non-reversible hashes and verifies the password', async () => {
    const hasher = new ScryptPasswordHasher();
    const first = await hasher.hash('correct-horse-battery-staple');
    const second = await hasher.hash('correct-horse-battery-staple');
    expect(first).not.toContain('correct-horse-battery-staple');
    expect(first).not.toBe(second);
    await expect(hasher.verify('correct-horse-battery-staple', first)).resolves.toBe(true);
    await expect(hasher.verify('wrong-password', first)).resolves.toBe(false);
  });
});
