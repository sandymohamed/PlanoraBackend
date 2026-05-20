import './shared/utils/expressAsyncPatch';
import { createApp } from './app';
import { env } from './config/env';
import { connectDatabase } from './shared/utils/database';
import { connectRedis } from './shared/utils/redis';
import { initializeQueues } from './infrastructure/queue/queue.service';
import { logger } from './shared/utils/logger';
import { shutdownPostHog } from './infrastructure/analytics/posthog';

const app = createApp();

async function bootstrap() {
  await connectDatabase();
  try {
    await connectRedis();
    await initializeQueues();
  } catch (e) {
    logger.warn('Redis/queues unavailable — running without background jobs', e);
  }

  app.listen(env.port, '0.0.0.0', () => {
    logger.info(`Planora API listening on http://0.0.0.0:${env.port} (LAN: use your PC IPv4, e.g. http://192.168.x.x:${env.port})`);
  });
}

bootstrap().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled promise rejection (API kept running)', reason);
});

process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught exception', err);
});

process.on('SIGTERM', async () => {
  await shutdownPostHog();
  process.exit(0);
});
