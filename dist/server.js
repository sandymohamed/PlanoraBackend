"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sentry_1 = require("./infrastructure/sentry/sentry");
(0, sentry_1.initSentry)();
// Load Express only after Sentry has initialized so Sentry can instrument it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./shared/utils/expressAsyncPatch');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createApp } = require('./app');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { env } = require('./config/env');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { validateProductionEnv } = require('./config/envValidation');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { connectDatabase } = require('./shared/utils/database');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { connectRedis } = require('./shared/utils/redis');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { initializeQueues } = require('./infrastructure/queue/queue.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { logger } = require('./shared/utils/logger');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { shutdownPostHog } = require('./infrastructure/analytics/posthog');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { emailService } = require('./domains/auth/email.service');
const app = createApp();
async function bootstrap() {
    validateProductionEnv();
    await connectDatabase();
    try {
        await connectRedis();
        await initializeQueues();
    }
    catch (e) {
        logger.warn('Redis/queues unavailable — running without background jobs', e);
    }
    app.listen(env.port, '0.0.0.0', () => {
        logger.info(`Planora API listening on http://0.0.0.0:${env.port} (LAN: use your PC IPv4, e.g. http://192.168.x.x:${env.port})`);
    });
    // Non-blocking SMTP health log so operators can confirm email at boot.
    if (emailService.isConfigured()) {
        emailService
            .verifyConnection()
            .then((ok) => ok
            ? logger.info('SMTP verified — transactional email is ready')
            : logger.warn('SMTP configured but verification failed — emails may not send'))
            .catch(() => logger.warn('SMTP verification error'));
    }
    else {
        logger.warn('SMTP not configured — emails will be logged only (set SMTP_USER/SMTP_PASS)');
    }
}
bootstrap().catch((err) => {
    logger.error('Failed to start server', err);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection (API kept running)', reason);
    (0, sentry_1.captureException)(reason);
});
process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', err);
    (0, sentry_1.captureException)(err);
});
process.on('SIGTERM', async () => {
    await shutdownPostHog();
    process.exit(0);
});
