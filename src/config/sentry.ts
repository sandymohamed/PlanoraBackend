import * as Sentry from '@sentry/node';

export const initSentry = () => {
  if (!process.env.SENTRY_DSN) {
    console.warn('[Sentry] No DSN provided — crash reporting disabled');
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 1.0, // Adjust to 0.2 in production
    enabled: process.env.NODE_ENV === 'production',
  });

  console.log('[Sentry] Initialized successfully');
};