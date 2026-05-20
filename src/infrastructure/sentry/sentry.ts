/**
 * Sentry (optional). Install when npm SSL works:
 *   npm install @sentry/node
 * Set SENTRY_DSN in .env
 */
import { env } from '../../config/env';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Sentry: any = null;

export function initSentry(): void {
  if (!env.sentry.dsn) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn: env.sentry.dsn,
      environment: env.sentry.environment,
      tracesSampleRate: env.sentry.tracesSampleRate,
    });
  } catch {
    console.warn('[Planora] @sentry/node not installed — crash reporting disabled');
  }
}

export function captureException(error: unknown): void {
  Sentry?.captureException?.(error);
}
