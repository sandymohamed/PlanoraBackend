"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("./shared/utils/expressAsyncPatch");
const app_1 = require("./app");
const env_1 = require("./config/env");
const database_1 = require("./shared/utils/database");
const redis_1 = require("./shared/utils/redis");
const queue_service_1 = require("./infrastructure/queue/queue.service");
const logger_1 = require("./shared/utils/logger");
const posthog_1 = require("./infrastructure/analytics/posthog");
const app = (0, app_1.createApp)();
async function bootstrap() {
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
}
bootstrap().catch((err) => {
    logger_1.logger.error('Failed to start server', err);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    logger_1.logger.error('Unhandled promise rejection (API kept running)', reason);
});
process.on('uncaughtException', (err) => {
    logger_1.logger.error('Uncaught exception', err);
});
process.on('SIGTERM', async () => {
    await (0, posthog_1.shutdownPostHog)();
    process.exit(0);
});
