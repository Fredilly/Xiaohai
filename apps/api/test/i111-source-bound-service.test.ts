import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI111SourceBoundFormalApiService } from '../src/picture-book/i111-source-bound-service.js';
import { PictureBookService } from '../src/picture-book/picture-book-service.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const bookId = '90d7f77e-ae23-40ef-90b6-a672412c6318';
const page1Id = '6fe359ee-71b0-43f5-b49b-08fe2b48a9cb';
const page2Id = 'eae00ed5-6026-4a41-b95a-6c9eea09d076';
const illustrationId = '00000000-1111-4222-8333-444444444444';
const db = { transaction: () => Promise.resolve(null) } as never;

const input = (pageId = page1Id, regenerate = false) => ({
  consumerUserId: ownerId,
  pictureBookId: bookId,
  pageId,
  regenerate,
});

describe('I111 real PictureBookService with no Redis broadcast', () => {
  beforeEach(() => vi.stubEnv('APP_ENV', 'dev'));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    [page1Id, 1, false],
    [page2Id, 1, false],
    [page2Id, 2, true],
  ])(
    'binds the real method to the fixed page/revision %#',
    async (pageId, revision, regenerate) => {
      const invoked = vi
        .spyOn(PictureBookService.prototype, 'generateIllustration')
        .mockImplementation(async function (this: PictureBookService, user, book, page, next) {
          expect([user, book, page, next]).toEqual([ownerId, bookId, pageId, regenerate]);
          const queue = this as unknown as {
            imageQueue: { notify: (id: string) => Promise<void> };
            config: {
              imageEnabled: boolean;
              imageModel: string;
              imageBudget: { amountMinor: number };
            };
          };
          expect(queue.config).toMatchObject({
            imageEnabled: true,
            imageModel: 'qwen-image-3.0',
            imageBudget: { amountMinor: 25 },
          });
          await queue.imageQueue.notify(illustrationId);
          return {
            pictureBookId: bookId,
            pageId: page,
            revisionNumber: revision,
            illustrationId,
            status: 'QUEUED' as const,
          };
        });
      const prepare = createI111SourceBoundFormalApiService(db);
      expect(await prepare.prepareViaFormalApi(input(pageId, regenerate))).toMatchObject({
        illustrationId,
        revisionNumber: revision,
      });
      await expect(prepare.prepareViaFormalApi(input(pageId, regenerate))).rejects.toThrow(
        'I111_SOURCE_BOUND_API_STOP',
      );
      expect(invoked).toHaveBeenCalledOnce();
    },
  );

  it('rejects invalid owner, book, page, regeneration and production before DB use', async () => {
    const invoked = vi.spyOn(PictureBookService.prototype, 'generateIllustration');
    for (const invalid of [
      { consumerUserId: 'wrong' },
      { pictureBookId: 'wrong' },
      { pageId: 'wrong' },
      { pageId: page1Id, regenerate: true },
      { regenerate: 'false' },
      { extra: 'unexpected' },
    ]) {
      const prepare = createI111SourceBoundFormalApiService(db);
      await expect(
        prepare.prepareViaFormalApi({ ...input(), ...invalid } as never),
      ).rejects.toThrow('I111_SOURCE_BOUND_API_STOP');
    }
    expect(invoked).not.toHaveBeenCalled();
    vi.stubEnv('APP_ENV', 'production');
    expect(() => createI111SourceBoundFormalApiService(db)).toThrow('I111_SOURCE_BOUND_API_STOP');
  });

  it('does not retry after an uncertain formal API error or a missing notification', async () => {
    const invoked = vi
      .spyOn(PictureBookService.prototype, 'generateIllustration')
      .mockRejectedValue(new Error('uncertain commit; secret detail'));
    const prepare = createI111SourceBoundFormalApiService(db);
    await expect(prepare.prepareViaFormalApi(input())).rejects.toThrow(
      'I111_SOURCE_BOUND_API_STOP',
    );
    await expect(prepare.prepareViaFormalApi(input())).rejects.toThrow(
      'I111_SOURCE_BOUND_API_STOP',
    );
    expect(invoked).toHaveBeenCalledOnce();

    invoked.mockResolvedValue({
      pictureBookId: bookId,
      pageId: page1Id,
      revisionNumber: 1,
      illustrationId,
      status: 'QUEUED',
    });
    const noNotification = createI111SourceBoundFormalApiService(db);
    await expect(noNotification.prepareViaFormalApi(input())).rejects.toThrow(
      'I111_SOURCE_BOUND_API_STOP',
    );
  });

  it('cannot hide a duplicate queue notification inside the underlying API catch', async () => {
    vi.spyOn(PictureBookService.prototype, 'generateIllustration').mockImplementation(
      async function (this: PictureBookService) {
        const queue = this as unknown as {
          imageQueue: { notify: (id: string) => Promise<void> };
        };
        await queue.imageQueue.notify(illustrationId);
        try {
          await queue.imageQueue.notify(illustrationId);
        } catch {
          // Mirrors PictureBookService swallowing a queue notification error.
        }
        return {
          pictureBookId: bookId,
          pageId: page1Id,
          revisionNumber: 1,
          illustrationId,
          status: 'QUEUED' as const,
        };
      },
    );
    const prepare = createI111SourceBoundFormalApiService(db);
    await expect(prepare.prepareViaFormalApi(input())).rejects.toThrow(
      'I111_SOURCE_BOUND_API_STOP',
    );
  });
});
