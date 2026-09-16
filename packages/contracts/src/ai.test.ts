import { describe, expect, it } from 'vitest';
import { aiJobSchema, createAiJobRequestSchema } from './ai.js';

describe('AI platform contracts', () => {
  it('rejects business workflow fields and unsupported providers', () => {
    expect(
      createAiJobRequestSchema.safeParse({
        projectTitle: 'probe',
        prompt: 'hello',
        provider: 'MOCK',
        model: 'mock-v1',
        timeoutMs: 1000,
        maxAttempts: 1,
        storyId: 'not-m8',
      }).success,
    ).toBe(false);
    expect(
      createAiJobRequestSchema.safeParse({
        projectTitle: 'probe',
        prompt: 'hello',
        provider: 'OTHER',
        model: 'x',
        timeoutMs: 1000,
        maxAttempts: 1,
      }).success,
    ).toBe(false);
  });

  it('does not expose job input through the response contract', () => {
    const response = {
      id: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      projectTitle: 'probe',
      provider: 'MOCK',
      model: 'mock-v1',
      status: 'QUEUED',
      result: null,
      moderation: null,
      usage: null,
      costMetadata: null,
      attemptCount: 0,
      maxAttempts: 1,
      timeoutMs: 1000,
      lastErrorCode: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      input: { prompt: 'secret prompt' },
    };
    expect(aiJobSchema.safeParse(response).success).toBe(false);
  });
});
