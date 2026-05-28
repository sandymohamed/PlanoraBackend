import { logger } from '../shared/utils/logger';

const REQUIRED_PRODUCTION = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DATABASE_URL', 'REDIS_URL'] as const;

export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const missing = REQUIRED_PRODUCTION.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required production env: ${missing.join(', ')}`);
  }

  if ((process.env.JWT_SECRET?.length ?? 0) < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
  }

  if (!process.env.SMTP_USER && !process.env.SMTP_PASS) {
    logger.warn('SMTP not configured — password reset emails will be logged only');
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_PROJECT_ID) {
    logger.warn('Firebase not configured — push notifications disabled');
  }

  logger.info('Production environment validation passed');
}
