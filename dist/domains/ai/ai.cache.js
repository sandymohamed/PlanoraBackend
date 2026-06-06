"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCacheKey = generateCacheKey;
exports.getCachedPlan = getCachedPlan;
exports.setCachedPlan = setCachedPlan;
exports.clearAiPlanCache = clearAiPlanCache;
const logger_1 = require("../../shared/utils/logger");
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const cache = new Map();
/**
 * Normalize goal text for stable cache keys.
 * Note: userId is intentionally excluded so identical goals are shared across
 * users — this maximizes cache hits and minimizes free-tier token usage.
 */
function generateCacheKey(input) {
    const goal = input.goal.trim().toLowerCase().replace(/\s+/g, ' ');
    const tier = (input.tier ?? 'free').toLowerCase();
    const category = (input.category ?? 'general').trim().toLowerCase().replace(/\s+/g, ' ');
    return `${goal}|${category}|${input.durationDays}|${input.hoursPerDay}|${tier}`;
}
function getCachedPlan(key) {
    const entry = cache.get(key);
    if (!entry)
        return null;
    if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        return null;
    }
    logger_1.logger.info('[AI CACHE HIT]', { key: key.substring(0, 80) });
    return entry.plan;
}
function setCachedPlan(key, plan) {
    cache.set(key, {
        plan,
        expiresAt: Date.now() + TTL_MS,
    });
}
/** Test helper — clear in-memory cache */
function clearAiPlanCache() {
    cache.clear();
}
