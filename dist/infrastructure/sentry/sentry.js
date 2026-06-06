"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSentry = initSentry;
exports.captureException = captureException;
/**
 * Sentry (optional). Install when npm SSL works:
 *   npm install @sentry/node
 * Set SENTRY_DSN in .env
 */
const env_1 = require("../../config/env");
const logger_1 = require("../../shared/utils/logger");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Sentry = null;
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
function isSensitiveKey(key) {
    const k = key.toLowerCase().replace(/[^a-z]/g, '');
    return SENSITIVE_KEYS.some((s) => k.includes(s.replace(/[^a-z]/g, '')));
}
/** Recursively redact sensitive values so PII never reaches Sentry. */
function scrub(value, depth = 0) {
    if (depth > 6 || value == null)
        return value;
    if (Array.isArray(value))
        return value.map((v) => scrub(v, depth + 1));
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = isSensitiveKey(k) ? '[REDACTED]' : scrub(v, depth + 1);
        }
        return out;
    }
    return value;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function beforeSend(event) {
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
    }
    catch {
        /* never let scrubbing break reporting */
    }
    return event;
}
function initSentry() {
    if (!env_1.env.sentry.dsn) {
        if (env_1.env.isProduction) {
            logger_1.logger.warn('SENTRY_DSN not set — backend error reporting is disabled in production');
        }
        return;
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        Sentry = require('@sentry/node');
        Sentry.init({
            dsn: env_1.env.sentry.dsn,
            environment: env_1.env.sentry.environment,
            tracesSampleRate: env_1.env.sentry.tracesSampleRate,
            // Do not attach request bodies/headers automatically; we scrub in beforeSend.
            sendDefaultPii: false,
            beforeSend,
        });
        logger_1.logger.info('Sentry initialized', { environment: env_1.env.sentry.environment });
    }
    catch {
        console.warn('[Planora] @sentry/node not installed — crash reporting disabled');
    }
}
function captureException(error, context) {
    if (!Sentry)
        return;
    if (context) {
        Sentry.withScope?.((scope) => {
            scope.setContext('details', scrub(context));
            Sentry.captureException?.(error);
        });
        return;
    }
    Sentry.captureException?.(error);
}
