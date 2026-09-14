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
import { StaffSessionService } from './auth/staff-session.js';

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
const staffAuth = new StaffAuthService(
  new DrizzleStaffAccountRepository(db),
  new ScryptPasswordHasher(),
  new StaffSessionService(config.STAFF_SESSION_SECRET, config.STAFF_SESSION_TTL_SECONDS),
);
const app = buildApp({ consumerAuth, staffAuth });
app.addHook('onClose', async () => pool.end());

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error({ err: error }, 'API startup failed');
  process.exitCode = 1;
}
