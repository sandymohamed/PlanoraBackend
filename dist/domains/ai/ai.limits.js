"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAiDailyLimit = checkAiDailyLimit;
exports.resetAiLimits = resetAiLimits;
const logger_1 = require("../../shared/utils/logger");
const DEFAULT_DAILY_LIMIT = 10;
const counters = new Map();
function todayKey() {
    return new Date().toISOString().slice(0, 10);
}
function getDailyLimit() {
    const env = process.env.AI_DAILY_LIMIT_FREE;
    if (env) {
        const n = parseInt(env, 10);
        if (!Number.isNaN(n) && n >= 0)
            return n;
    }
    return DEFAULT_DAILY_LIMIT;
}
/**
 * Check whether the user may use online OpenAI for this request.
 * Increments counter only when `consume` is true (online attempt).
 */
function checkAiDailyLimit(userId, consume = false) {
    const limit = getDailyLimit();
    const dateKey = todayKey();
    let entry = counters.get(userId);
    if (!entry || entry.dateKey !== dateKey) {
        entry = { count: 0, dateKey };
        counters.set(userId, entry);
    }
    const allowed = entry.count < limit;
    if (consume && allowed) {
        entry.count += 1;
        counters.set(userId, entry);
    }
    const forceOffline = !allowed;
    if (forceOffline) {
        logger_1.logger.warn('[AI OFFLINE MODE USED] daily limit reached', {
            userId,
            count: entry.count,
            limit,
        });
    }
    return {
        allowed,
        count: entry.count,
        limit,
        forceOffline,
    };
}
/** Test helper */
function resetAiLimits() {
    counters.clear();
}
