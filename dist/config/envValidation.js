"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateProductionEnv = validateProductionEnv;
const logger_1 = require("../shared/utils/logger");
const REQUIRED_PRODUCTION = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DATABASE_URL', 'REDIS_URL'];
function validateProductionEnv() {
    if (process.env.NODE_ENV !== 'production')
        return;
    const missing = REQUIRED_PRODUCTION.filter((key) => !process.env[key]?.trim());
    if (missing.length > 0) {
        throw new Error(`Missing required production env: ${missing.join(', ')}`);
    }
    if ((process.env.JWT_SECRET?.length ?? 0) < 32) {
        throw new Error('JWT_SECRET must be at least 32 characters in production');
    }
    if (!process.env.SMTP_USER && !process.env.SMTP_PASS) {
        logger_1.logger.warn('SMTP not configured — password reset emails will be logged only');
    }
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_PROJECT_ID) {
        logger_1.logger.warn('Firebase not configured — push notifications disabled');
    }
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
        logger_1.logger.warn('OPENROUTER_API_KEY not set — AI plans will use the offline generator only');
    }
    if (!process.env.SENTRY_DSN?.trim()) {
        logger_1.logger.warn('SENTRY_DSN not set — backend error reporting is disabled');
    }
    if (!process.env.POSTHOG_API_KEY?.trim()) {
        logger_1.logger.warn('POSTHOG_API_KEY not set — product analytics events will be dropped');
    }
    logger_1.logger.info('Production environment validation passed');
}
