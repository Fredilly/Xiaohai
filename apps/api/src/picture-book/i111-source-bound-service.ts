import { assertI111SessionBoundDatabase, type DatabaseHandle } from '@xiaohai/db';
import type { AiQueue } from '../ai/ai-queue.js';
import type { ImageQueue } from './image-queue.js';
import { PictureBookService, type PictureBookAiConfig } from './picture-book-service.js';

const STOP_CODE = 'I111_SOURCE_BOUND_API_STOP';
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const scope = Object.freeze({
  ownerId: '11111111-1111-4111-8111-111111111111',
  bookId: '90d7f77e-ae23-40ef-90b6-a672412c6318',
  page1Id: '6fe359ee-71b0-43f5-b49b-08fe2b48a9cb',
  page2Id: 'eae00ed5-6026-4a41-b95a-6c9eea09d076',
  budgetKey: 'I111_MAC_PLAN_B_THREE_PAID_IMAGE_CALLS',
  windowKey: 'I111_20261117_ISOLATED_BOOK_ONLY',
  model: 'qwen-image-3.0',
});

type Db = DatabaseHandle;

function stop(): never {
  throw new Error(STOP_CODE);
}

const textQueue: AiQueue = Object.freeze({
  notify() {
    return Promise.reject(new Error(STOP_CODE));
  },
  async close() {},
});

const config: PictureBookAiConfig = Object.freeze({
  enabled: false,
  provider: 'MOCK',
  model: 'DISABLED',
  maxAttempts: 1,
  timeoutMs: 600_000,
  imageEnabled: true,
  imageProvider: 'BAILIAN',
  imageModel: scope.model,
  imageBudget: Object.freeze({
    budgetKey: scope.budgetKey,
    windowKey: scope.windowKey,
    amountMinor: 25,
    globalLimitMinor: 200,
    consumerLimitMinor: 200,
  }),
});

/**
 * Construct the real PictureBookService.generateIllustration path, but replace
 * the Redis queue with an in-memory one-ID confirmation. No live connection or
 * background Worker can be started by construction. A separate coordinator
 * must independently verify owner authorization, DB isolation and reservation
 * before it invokes the one-use prepare method.
 */
export function createI111SourceBoundFormalApiService(db: Db) {
  if (process.env.APP_ENV !== 'dev' || !db || typeof db.transaction !== 'function') stop();
  try {
    assertI111SessionBoundDatabase(db);
  } catch {
    stop();
  }
  let notifiedId: string | null = null;
  let notificationViolation = false;
  let prepareConsumed = false;
  const imageQueue: ImageQueue = Object.freeze({
    notify(id: string): Promise<void> {
      if (notificationViolation || !UUID.test(id) || notifiedId !== null) {
        // The underlying service catches notification exceptions; remember
        // this violation so the outer one-shot cannot mistake it for success.
        notificationViolation = true;
        return Promise.reject(new Error(STOP_CODE));
      }
      notifiedId = id;
      return Promise.resolve();
    },
    async close() {},
  });
  const service = new PictureBookService(db, textQueue, imageQueue, config);

  return Object.freeze({
    async prepareViaFormalApi(input: {
      consumerUserId: string;
      pictureBookId: string;
      pageId: string;
      regenerate: boolean;
    }) {
      try {
        assertI111SessionBoundDatabase(db);
      } catch {
        stop();
      }
      if (
        prepareConsumed ||
        !input ||
        Object.keys(input).length !== 4 ||
        input.consumerUserId !== scope.ownerId ||
        input.pictureBookId !== scope.bookId ||
        !(
          (input.pageId === scope.page1Id && input.regenerate === false) ||
          (input.pageId === scope.page2Id && typeof input.regenerate === 'boolean')
        )
      )
        stop();
      prepareConsumed = true;
      try {
        const result = await service.generateIllustration(
          input.consumerUserId,
          input.pictureBookId,
          input.pageId,
          input.regenerate,
        );
        const expectedRevision = input.pageId === scope.page1Id ? 1 : input.regenerate ? 2 : 1;
        if (
          result.pictureBookId !== scope.bookId ||
          result.pageId !== input.pageId ||
          result.revisionNumber !== expectedRevision ||
          result.status !== 'QUEUED' ||
          !UUID.test(result.illustrationId) ||
          notificationViolation ||
          notifiedId !== result.illustrationId
        )
          stop();
        return Object.freeze(result);
      } catch {
        // A committed reservation is possible even if the DB result is unknown.
        // Never attempt a second API call or leak internal errors.
        stop();
      }
    },
  });
}
