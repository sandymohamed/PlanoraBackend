/**
 * Sentry (optional). Install when npm SSL works:
 *   npm install @sentry/node
 * Set SENTRY_DSN in .env
 */
import { env } from '../../config/env';
import { logger } from '../../shared/utils/logger';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Sentry: any = null;

const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'password_hash',
  'currentpassword',
  'newpassword',
  'otp',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'secret',
  'apikey',
  'api_key',
];

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z]/g, '');
  return SENSITIVE_KEYS.some((s) => k.includes(s.replace(/[^a-z]/g, '')));
}

/** Recursively redact sensitive values so PII never reaches Sentry. */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? '[REDACTED]' : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function beforeSend(event: any): any {
  try {
    if (event?.request?.headers) {
      event.request.headers = scrub(event.request.headers);
    }
    if (event?.request?.data) {
      event.request.data = scrub(event.request.data);
    }
    if (event?.request?.cookies) {
      event.request.cookies = '[REDACTED]';
    }
    if (event?.extra) {
      event.extra = scrub(event.extra);
    }
    if (event?.contexts) {
      event.contexts = scrub(event.contexts);
    }
  } catch {
    /* never let scrubbing break reporting */
  }
  return event;
}

export function initSentry(): void {
  if (!env.sentry.dsn) {
    if (env.isProduction) {
      logger.warn('SENTRY_DSN not set — backend error reporting is disabled in production');
    }
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn: env.sentry.dsn,
      environment: env.sentry.environment,
      tracesSampleRate: env.sentry.tracesSampleRate,
      // Do not attach request bodies/headers automatically; we scrub in beforeSend.
      sendDefaultPii: false,
      beforeSend,
    });
    logger.info('Sentry initialized', { environment: env.sentry.environment });
  } catch {
    console.warn('[Planora] @sentry/node not installed — crash reporting disabled');
  }
}

type SentryContext =
  | Record<string, unknown>
  | {
      tags?: Record<string, string | number | boolean | undefined>;
      extra?: Record<string, unknown>;
      contexts?: Record<string, unknown>;
    };

function applyScopeContext(
  scope: {
    setContext?: (k: string, v: unknown) => void;
    setTag?: (k: string, v: string) => void;
    setExtra?: (k: string, v: unknown) => void;
  },
  context?: SentryContext
): void {
  if (!context) return;
  const structured = context as { tags?: Record<string, unknown>; extra?: Record<string, unknown>; contexts?: Record<string, unknown> };

  if (structured.tags || structured.extra || structured.contexts) {
    Object.entries(structured.tags || {}).forEach(([key, value]) => {
      if (value !== undefined) scope.setTag?.(key, String(value));
    });
    Object.entries(structured.extra || {}).forEach(([key, value]) => {
      scope.setExtra?.(key, scrub(value));
    });
    Object.entries(structured.contexts || {}).forEach(([key, value]) => {
      scope.setContext?.(key, scrub(value));
    });
    return;
  }

  scope.setContext?.('details', scrub(context) as Record<string, unknown>);
}

export function captureException(error: unknown, context?: SentryContext): void {
  if (!Sentry) return;
  if (context) {
    Sentry.withScope?.((scope: {
      setContext?: (k: string, v: unknown) => void;
      setTag?: (k: string, v: string) => void;
      setExtra?: (k: string, v: unknown) => void;
    }) => {
      applyScopeContext(scope, context);
      Sentry.captureException?.(error);
    });
    return;
  }
  Sentry.captureException?.(error);
}

export function captureMessage(message: string, context?: SentryContext): void {
  if (!Sentry) return;
  if (context) {
    Sentry.withScope?.((scope: {
      setContext?: (k: string, v: unknown) => void;
      setTag?: (k: string, v: string) => void;
      setExtra?: (k: string, v: unknown) => void;
    }) => {
      applyScopeContext(scope, context);
      Sentry.captureMessage?.(message);
    });
    return;
  }
  Sentry.captureMessage?.(message);
}
