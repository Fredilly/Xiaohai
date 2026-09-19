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
import { AnimationService } from './animation/animation-service.js';
import { registerAnimationRoutes } from './animation/animation-routes.js';
import { RedisVideoQueue } from './animation/video-queue.js';
import { RedisCompositionQueue } from './animation/composition-queue.js';
import { StoreNetworkService } from './stores/store-service.js';
import { registerStoreRoutes } from './stores/store-routes.js';
import { InventorySearchService } from './inventory/inventory-service.js';
import { registerInventoryRoutes } from './inventory/inventory-routes.js';
import { InventoryOperationsService } from './inventory/inventory-operations-service.js';
import { registerInventoryOperationsRoutes } from './inventory/inventory-operations-routes.js';
import { RentalService } from './rental/rental-service.js';
import { registerRentalRoutes } from './rental/rental-routes.js';
import { FulfillmentService } from './fulfillment/fulfillment-service.js';
import { registerFulfillmentRoutes } from './fulfillment/fulfillment-routes.js';
import { loadDeliveryProvider } from './fulfillment/delivery-provider.js';
import { FranchiseService } from './franchise/franchise-service.js';
import { registerFranchiseRoutes } from './franchise/franchise-routes.js';
import { CommissionService } from './commission/commission-service.js';
import { registerCommissionRoutes } from './commission/commission-routes.js';
import { HqReadService } from './hq/hq-read-service.js';
import { registerHqReadRoutes } from './hq/hq-read-routes.js';

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
const commission = new CommissionService(db);
const commerce = new CommerceService(db, commission);
const content = new ContentService(db);
const app = buildApp({ consumerAuth, staffAuth, staffAuthorization, homeCms });
registerCommerceRoutes(app, { commerce, consumerSessions: sessions, staffAuthorization });
registerPaymentRoutes(app, {
  payments: new PaymentService(db, loadWeChatPayProvider(process.env), commission),
  consumerSessions: sessions,
  staffAuthorization,
});
registerContentRoutes(app, { content, consumerSessions: sessions, staffAuthorization });
registerStoreRoutes(app, { stores: new StoreNetworkService(db), staffAuthorization });
registerInventoryRoutes(app, { inventory: new InventorySearchService(db) });
registerInventoryOperationsRoutes(app, {
  operations: new InventoryOperationsService(db),
  staffAuthorization,
});
const pickupCodeSecret = config.PICKUP_CODE_SECRET ?? config.STAFF_SESSION_SECRET;
registerRentalRoutes(app, {
  rental: new RentalService(db, config.RENTAL_LOAN_DAYS, pickupCodeSecret),
  consumerSessions: sessions,
  staffAuthorization,
});
registerFulfillmentRoutes(app, {
  fulfillment: new FulfillmentService(
    db,
    commerce,
    pickupCodeSecret,
    loadDeliveryProvider(config.DELIVERY_PROVIDER),
  ),
  consumerSessions: sessions,
  staffAuthorization,
});
registerFranchiseRoutes(app, {
  franchise: new FranchiseService(db),
  consumerSessions: sessions,
  staffAuthorization,
});
registerCommissionRoutes(app, { commission, consumerSessions: sessions, staffAuthorization });
registerHqReadRoutes(app, { hqRead: new HqReadService(db), staffAuthorization });
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

const videoQueue = new RedisVideoQueue(config.REDIS_URL, () =>
  app.log.error({ errorCode: 'REDIS_UNAVAILABLE' }, 'Animation video queue Redis error'),
);
const compositionQueue = new RedisCompositionQueue(config.REDIS_URL, () =>
  app.log.error({ errorCode: 'REDIS_UNAVAILABLE' }, 'Animation composition queue Redis error'),
);

registerAnimationRoutes(app, {
  animation: new AnimationService(
    db,
    aiQueue,
    {
      enabled: config.ANIMATION_AI_ENABLED,
      provider: config.ANIMATION_AI_PROVIDER,
      model: config.ANIMATION_AI_MODEL,
      maxAttempts: config.ANIMATION_AI_MAX_ATTEMPTS,
      timeoutMs: config.ANIMATION_AI_TIMEOUT_MS,
    },
    app.log,
    videoQueue,
    {
      enabled: config.ANIMATION_VIDEO_ENABLED,
      provider: config.ANIMATION_VIDEO_PROVIDER,
      model: config.ANIMATION_VIDEO_MODEL,
    },
    compositionQueue,
    {
      compositionEnabled: config.ANIMATION_COMPOSITION_ENABLED,
      maxGenerations: config.ANIMATION_MAX_GENERATIONS,
      maxCompositions: config.ANIMATION_MAX_COMPOSITIONS,
      maxPlannedDurationMs: config.ANIMATION_MAX_PLANNED_DURATION_MS,
    },
  ),
  consumerSessions: sessions,
});

app.addHook('onClose', async () => {
  await aiQueue.close();
  await imageQueue.close();
  await videoQueue.close();
  await compositionQueue.close();
  await pool.end();
});
try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error({ err: error }, 'API startup failed');
  process.exitCode = 1;
}
