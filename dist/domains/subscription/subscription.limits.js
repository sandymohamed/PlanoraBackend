"use strict";
/**
 * Subscription & AI quota limits — single source for backend enforcement.
 * Align with PlanoraMobile/src/config/aiLimits.ts when changing tiers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUBSCRIPTION_LIMITS = void 0;
exports.getLimitsForTier = getLimitsForTier;
exports.SUBSCRIPTION_LIMITS = {
    FREE: {
        maxActiveGoals: 3,
        // Public beta launch limit: 3 AI plans per user per month.
        maxAiPerMonth: 3,
        maxAiPerDay: 3,
        adsEnabled: true,
    },
    PRO: {
        maxActiveGoals: 25,
        maxAiPerMonth: 30,
        maxAiPerDay: 15,
        adsEnabled: false,
    },
    PREMIUM: {
        maxActiveGoals: 999,
        maxAiPerMonth: 999,
        maxAiPerDay: 999,
        adsEnabled: false,
    },
};
function getLimitsForTier(tier) {
    return exports.SUBSCRIPTION_LIMITS[tier] ?? exports.SUBSCRIPTION_LIMITS.FREE;
}
