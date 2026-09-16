import { loadServiceConfig } from '@xiaohai/config';
import { createDatabase } from '@xiaohai/db';
import { buildApp } from './app.js';
import { ConsumerAuthService } from './auth/consumer-auth-service.js';
import { DrizzleConsumerIdentityRepository } from './auth/consumer-repository.js';
import { ConsumerSessionService } from './auth/session.js';
import { HttpWeChatAuthProvider } from './auth/wechat-provider.js';
import { ScryptPasswordHasher } from './auth/password.js';
import { StaffAuthService } from './auth/staff-auth-service.js';
import { DrizzleStaffAccountRepository } from './auth/staff-repository.js';
import {
  DrizzleStaffAuthorizationRepository,
  StaffAuthorizationService,
} from './auth/staff-authorization.js';
import { StaffSessionService } from './auth/staff-session.js';
import { HomeCmsService } from './cms/home-cms-service.js';
import { CommerceService } from './commerce/commerce-service.js';
import { registerCommerceRoutes } from './commerce/commerce-routes.js';
import { loadWeChatPayProvider } from './payments/wechat-pay.js';
import { PaymentService } from './payments/payment-service.js';
import { registerPaymentRoutes } from './payments/payment-routes.js';
import { ContentService } from './content/content-service.js';
import { registerContentRoutes } from './content/content-routes.js';
import { RedisAiQueue } from './ai/ai-queue.js';
import { AiPlatformService } from './ai/ai-service.js';
import { registerAiRoutes } from './ai/ai-routes.js';
import { StoryService } from './story/story-service.js';
import { registerStoryRoutes } from './story/story-routes.js';
import { PictureBookService } from './picture-book/picture-book-service.js';
import { registerPictureBookRoutes } from './picture-book/picture-book-routes.js';
import { RedisImageQueue } from './picture-book/image-queue.js';

const config = loadServiceConfig(process.env);
const { db, pool } = createDatabase(process.env);
const provider = new HttpWeChatAuthProvider(
  config.WECHAT_APP_ID,
  config.WECHAT_APP_SECRET,
  config.WECHAT_AUTH_TIMEOUT_MS,
);
const sessions = new ConsumerSessionService(
  config.CONSUMER_SESSION_SECRET,
  config.CONSUMER_SESSION_TTL_SECONDS,
);
const consumerAuth = new ConsumerAuthService(
  config.WECHAT_APP_ID,
  provider,
  new DrizzleConsumerIdentityRepository(db),
  sessions,
);
const staffSessions = new StaffSessionService(
  config.STAFF_SESSION_SECRET,
  config.STAFF_SESSION_TTL_SECONDS,
);
const staffAuth = new StaffAuthService(
  new DrizzleStaffAccountRepository(db),
  new ScryptPasswordHasher(),
  staffSessions,
);
const staffAuthorization = new StaffAuthorizationService(
  new DrizzleStaffAuthorizationRepository(db),
  staffSessions,
);
const homeCms = new HomeCmsService(db);
const commerce = new CommerceService(db);
const content = new ContentService(db);
const app = buildApp({ consumerAuth, staffAuth, staffAuthorization, homeCms });
registerCommerceRoutes(app, { commerce, consumerSessions: sessions, staffAuthorization });
registerPaymentRoutes(app, {
  payments: new PaymentService(db, loadWeChatPayProvider(process.env)),
  consumerSessions: sessions,
  staffAuthorization,
});
registerContentRoutes(app, { content, consumerSessions: sessions, staffAuthorization });
const aiQueue = new RedisAiQueue(config.REDIS_URL, () =>
  app.log.error({ errorCode: 'REDIS_UNAVAILABLE' }, 'AI queue Redis error'),
);
registerAiRoutes(app, { ai: new AiPlatformService(db, aiQueue, app.log), staffAuthorization });

const story = new StoryService(
  db,
  aiQueue,
  {
    enabled: config.STORY_AI_ENABLED,
    provider: config.STORY_AI_PROVIDER,
    model: config.STORY_AI_MODEL,
    maxAttempts: config.STORY_AI_MAX_ATTEMPTS,
    timeoutMs: config.STORY_AI_TIMEOUT_MS,
  },
  app.log,
);

registerStoryRoutes(app, {
  story,
  consumerSessions: sessions,
});

const imageQueue = new RedisImageQueue(config.REDIS_URL, () =>
  app.log.error({ errorCode: 'REDIS_UNAVAILABLE' }, 'Picture Book image queue Redis error'),
);
const pictureBook = new PictureBookService(
  db,
  aiQueue,
  imageQueue,
  {
    enabled: config.PICTURE_BOOK_AI_ENABLED,
    provider: config.PICTURE_BOOK_AI_PROVIDER,
    model: config.PICTURE_BOOK_AI_MODEL,
    maxAttempts: config.PICTURE_BOOK_AI_MAX_ATTEMPTS,
    timeoutMs: config.PICTURE_BOOK_AI_TIMEOUT_MS,
    imageEnabled: config.PICTURE_BOOK_IMAGE_ENABLED,
    imageProvider: config.PICTURE_BOOK_IMAGE_PROVIDER,
    imageModel: config.PICTURE_BOOK_IMAGE_MODEL,
  },
  app.log,
);

registerPictureBookRoutes(app, {
  pictureBook,
  consumerSessions: sessions,
});

app.addHook('onClose', async () => {
  await aiQueue.close();
  await imageQueue.close();
  await pool.end();
});
try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error({ err: error }, 'API startup failed');
  process.exitCode = 1;
}
