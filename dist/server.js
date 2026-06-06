"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("./shared/utils/expressAsyncPatch");
const app_1 = require("./app");
const env_1 = require("./config/env");
const envValidation_1 = require("./config/envValidation");
const database_1 = require("./shared/utils/database");
const redis_1 = require("./shared/utils/redis");
const queue_service_1 = require("./infrastructure/queue/queue.service");
const logger_1 = require("./shared/utils/logger");
const posthog_1 = require("./infrastructure/analytics/posthog");
const sentry_1 = require("./infrastructure/sentry/sentry");
const email_service_1 = require("./domains/auth/email.service");
const app = (0, app_1.createApp)();
async function bootstrap() {
    (0, envValidation_1.validateProductionEnv)();
    await (0, database_1.connectDatabase)();
    try {
        await (0, redis_1.connectRedis)();
        await (0, queue_service_1.initializeQueues)();
    }
    catch (e) {
        logger_1.logger.warn('Redis/queues unavailable — running without background jobs', e);
    }
    app.listen(env_1.env.port, '0.0.0.0', () => {
        logger_1.logger.info(`Planora API listening on http://0.0.0.0:${env_1.env.port} (LAN: use your PC IPv4, e.g. http://192.168.x.x:${env_1.env.port})`);
    });
    // Non-blocking SMTP health log so operators can confirm email at boot.
    if (email_service_1.emailService.isConfigured()) {
        email_service_1.emailService
            .verifyConnection()
            .then((ok) => ok
            ? logger_1.logger.info('SMTP verified — transactional email is ready')
            : logger_1.logger.warn('SMTP configured but verification failed — emails may not send'))
            .catch(() => logger_1.logger.warn('SMTP verification error'));
    }
    else {
        logger_1.logger.warn('SMTP not configured — emails will be logged only (set SMTP_USER/SMTP_PASS)');
    }
}
bootstrap().catch((err) => {
    logger_1.logger.error('Failed to start server', err);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    logger_1.logger.error('Unhandled promise rejection (API kept running)', reason);
    (0, sentry_1.captureException)(reason);
});
process.on('uncaughtException', (err) => {
    logger_1.logger.error('Uncaught exception', err);
    (0, sentry_1.captureException)(err);
});
process.on('SIGTERM', async () => {
    await (0, posthog_1.shutdownPostHog)();
    process.exit(0);
});
