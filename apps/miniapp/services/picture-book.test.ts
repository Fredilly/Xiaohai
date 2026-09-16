import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateIllustration, generatePictureBookPlan } from './picture-book';

afterEach(() => vi.unstubAllGlobals());

describe('Mini Program Picture Book boundary', () => {
  it('never sends provider or model for planning and illustration generation', async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal('wx', {
      getStorageSync: () => 'consumer-token',
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
      request: (input: Record<string, unknown> & { success: (value: unknown) => void }) => {
        requests.push(input);
        input.success({ statusCode: 202, data: {} });
      },
    });

    await generatePictureBookPlan('book-id', 'CHARACTERS');
    await generateIllustration('book-id', 'page-id', true);

    expect(requests[0]).toMatchObject({ method: 'POST', data: { operation: 'CHARACTERS' } });
    expect(requests[1]).toMatchObject({ method: 'POST', data: {} });
    expect(requests[1]!.url).toContain('/illustrations/regenerate');
    expect(JSON.stringify(requests)).not.toMatch(/provider|model/i);
  });
});
