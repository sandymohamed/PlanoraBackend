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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Sentry = null;
function initSentry() {
    if (!env_1.env.sentry.dsn)
        return;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        Sentry = require('@sentry/node');
        Sentry.init({
            dsn: env_1.env.sentry.dsn,
            environment: env_1.env.sentry.environment,
            tracesSampleRate: env_1.env.sentry.tracesSampleRate,
        });
    }
    catch {
        console.warn('[Planora] @sentry/node not installed — crash reporting disabled');
    }
}
function captureException(error) {
    Sentry?.captureException?.(error);
}
