"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveGenerationMode = resolveGenerationMode;
exports.computeDurationDays = computeDurationDays;
exports.computeHoursPerDay = computeHoursPerDay;
const logger_1 = require("../../shared/utils/logger");
/**
 * Decide generation mode.
 * Priority when resolving next step: cache (caller) → offline if forced → online.
 */
function resolveGenerationMode(ctx) {
    if (ctx.cacheHit) {
        return 'cache';
    }
    if (ctx.forceOffline || !ctx.hasApiKey) {
        if (!ctx.hasApiKey) {
            logger_1.logger.info('[AI OFFLINE MODE USED] no AI provider configured');
        }
        return 'offline';
    }
    return 'online';
}
function computeDurationDays(targetDate) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const target = new Date(targetDate);
    if (Number.isNaN(target.getTime())) {
        return 30;
    }
    const diff = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return clamp(diff, 7, 365);
}
function computeHoursPerDay(weeklyHours) {
    return clamp(Math.round((weeklyHours / 7) * 10) / 10, 1, 12);
}
function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}
