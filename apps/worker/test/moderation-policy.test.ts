import { describe, expect, it } from 'vitest';
import { BaselineModerationAdapter } from '../src/moderation.js';

describe('production moderation boundary', () => {
  it('does not approve text when policy is unavailable', async () => {
    expect((await new BaselineModerationAdapter(true).moderate('hello', 'INPUT')).status).toBe(
      'BLOCKED',
    );
    expect((await new BaselineModerationAdapter(true).moderate('hello', 'OUTPUT')).status).toBe(
      'BLOCKED',
    );
    expect((await new BaselineModerationAdapter().moderate('hello', 'INPUT')).status).toBe(
      'REVIEW_REQUIRED',
    );
  });
});
