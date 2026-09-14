import { loadWorkerConfig } from '@xiaohai/config';
import pino from 'pino';

const config = loadWorkerConfig(process.env);
const logger = pino({ level: config.LOG_LEVEL });

logger.info({ appEnv: config.APP_ENV, service: 'worker' }, 'Worker foundation ready');
