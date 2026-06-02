import './shared/utils/expressAsyncPatch';
import { createApp } from './app';
import { env } from './config/env';
import { validateProductionEnv } from './config/envValidation';
import { connectDatabase } from './shared/utils/database';
import { connectRedis } from './shared/utils/redis';
import { initializeQueues } from './infrastructure/queue/queue.service';
import { logger } from './shared/utils/logger';
import { shutdownPostHog } from './infrastructure/analytics/posthog';
import { captureException } from './infrastructure/sentry/sentry';
import { emailService } from './domains/auth/email.service';

const app = createApp();

async function bootstrap() {
  validateProductionEnv();
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

  // Non-blocking SMTP health log so operators can confirm email at boot.
  if (emailService.isConfigured()) {
    emailService
      .verifyConnection()
      .then((ok) =>
        ok
          ? logger.info('SMTP verified — transactional email is ready')
          : logger.warn('SMTP configured but verification failed — emails may not send')
      )
      .catch(() => logger.warn('SMTP verification error'));
  } else {
    logger.warn('SMTP not configured — emails will be logged only (set SMTP_USER/SMTP_PASS)');
  }
}

bootstrap().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled promise rejection (API kept running)', reason);
  captureException(reason);
});

process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught exception', err);
  captureException(err);
});

process.on('SIGTERM', async () => {
  await shutdownPostHog();
  process.exit(0);
});
