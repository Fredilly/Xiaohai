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
app.addHook('onClose', async () => pool.end());
try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error({ err: error }, 'API startup failed');
  process.exitCode = 1;
}
