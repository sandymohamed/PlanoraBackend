"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPostHog = getPostHog;
exports.trackServerEvent = trackServerEvent;
exports.shutdownPostHog = shutdownPostHog;
/**
 * PostHog (optional). Install when npm SSL works:
 *   npm install posthog-node
 */
const env_1 = require("../../config/env");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client = null;
function getPostHog() {
    if (!env_1.env.posthog.apiKey)
        return null;
    if (!client) {
        try {
            const { PostHog } = require('posthog-node');
            client = new PostHog(env_1.env.posthog.apiKey, { host: env_1.env.posthog.host });
        }
        catch {
            console.warn('[Planora] posthog-node not installed — analytics disabled');
        }
    }
    return client;
}
function trackServerEvent(distinctId, event, properties) {
    const ph = getPostHog();
    ph?.capture?.({ distinctId, event, properties });
}
async function shutdownPostHog() {
    await client?.shutdown?.();
}
