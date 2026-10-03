import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  confirmPictureBookCharacters,
  generateIllustration,
  generatePictureBookPlan,
  reopenPictureBookCharacters,
  updatePictureBookCharacter,
} from './picture-book';

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

  it('supports Character Bible edit, confirm, and reopen actions', async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal('wx', {
      getStorageSync: () => 'consumer-token',
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
      request: (input: Record<string, unknown> & { success: (value: unknown) => void }) => {
        requests.push(input);
        input.success({ statusCode: 200, data: { pictureBook: {}, characters: [], pages: [] } });
      },
    });

    await updatePictureBookCharacter('book-id', 'character-id', {
      name: '小狐狸',
      description: '勇敢的朋友',
      canonicalVisualPrompt: 'orange fox with green scarf',
    });
    await confirmPictureBookCharacters('book-id');
    await reopenPictureBookCharacters('book-id');

    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ['PATCH', expect.stringContaining('/characters/character-id')],
      ['POST', expect.stringContaining('/characters/confirm')],
      ['POST', expect.stringContaining('/characters/reopen')],
    ]);
    expect(requests[0]!.data).toEqual({
      name: '小狐狸',
      description: '勇敢的朋友',
      canonicalVisualPrompt: 'orange fox with green scarf',
    });
  });
});
