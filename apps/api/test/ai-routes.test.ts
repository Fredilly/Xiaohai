import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { StaffSessionService } from '../src/auth/staff-session.js';
import { StaffAuthorizationService } from '../src/auth/staff-authorization.js';
import { registerAiRoutes } from '../src/ai/ai-routes.js';
import type { AiPlatformService } from '../src/ai/ai-service.js';
const sessions = new StaffSessionService('s'.repeat(32), 300);
const job = {
  id: randomUUID(),
  projectId: randomUUID(),
  projectTitle: 'P',
  provider: 'MOCK',
  model: 'm',
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
};
function fixture(permissions: string[], global = true) {
  const service = {
    enqueue: vi.fn().mockResolvedValue(job),
    list: vi.fn().mockResolvedValue({ jobs: [] }),
    get: vi.fn().mockResolvedValue(job),
    cancel: vi.fn().mockResolvedValue({ ...job, status: 'CANCELLED' }),
    retry: vi.fn().mockResolvedValue(job),
  };
  const auth = new StaffAuthorizationService(
    {
      loadContext: (id) =>
        Promise.resolve({
          staffAccountId: id,
          loginIdentifier: 'staff',
          permissions,
          dataScopes: [{ type: global ? 'GLOBAL' : 'STORE', id: global ? null : randomUUID() }],
        }),
    },
    sessions,
  );
  const app = buildApp({ logger: false });
  registerAiRoutes(app, { ai: service as unknown as AiPlatformService, staffAuthorization: auth });
  return { app, service, token: sessions.issue(randomUUID()).token };
}
describe('AI routes RBAC and validation', () => {
  it('requires Staff session, ai.manage and GLOBAL scope', async () => {
    for (const [permissions, global] of [
      [[], true],
      [['ai.manage'], false],
    ] as [string[], boolean][]) {
      const { app, service, token } = fixture(permissions, global);
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/staff/ai/jobs',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(403);
      expect(service.list).not.toHaveBeenCalled();
      await app.close();
    }
  });
  it('strictly rejects client identity, status and result fields', async () => {
    const { app, service, token } = fixture(['ai.manage']);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/ai/jobs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        projectTitle: 'P',
        prompt: 'x',
        provider: 'MOCK',
        model: 'm',
        timeoutMs: 1000,
        maxAttempts: 1,
        status: 'SUCCEEDED',
        staffId: randomUUID(),
      },
    });
    expect(response.statusCode).toBe(400);
    expect(service.enqueue).not.toHaveBeenCalled();
    await app.close();
  });
  it('accepts a minimal provider-neutral platform job for authorized HQ staff', async () => {
    const { app, service, token } = fixture(['ai.manage']);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/ai/jobs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        projectTitle: 'P',
        prompt: 'generic platform probe',
        provider: 'MOCK',
        model: 'm',
        timeoutMs: 1000,
        maxAttempts: 1,
      },
    });
    expect(response.statusCode).toBe(202);
    expect(service.enqueue).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ provider: 'MOCK' }),
    );
    await app.close();
  });
});
