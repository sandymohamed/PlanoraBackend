"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUBSCRIPTION_LIMITS = exports.getLimitsForTier = void 0;
exports.toServerPlanTier = toServerPlanTier;
exports.isPaidTier = isPaidTier;
exports.shouldServeAds = shouldServeAds;
exports.getDailyAIQuota = getDailyAIQuota;
exports.getMonthlyAIQuota = getMonthlyAIQuota;
const client_1 = require("@prisma/client");
const subscription_limits_1 = require("./subscription.limits");
Object.defineProperty(exports, "getLimitsForTier", { enumerable: true, get: function () { return subscription_limits_1.getLimitsForTier; } });
Object.defineProperty(exports, "SUBSCRIPTION_LIMITS", { enumerable: true, get: function () { return subscription_limits_1.SUBSCRIPTION_LIMITS; } });
/** Map Prisma tier to extended plan (PRO reserved for future RevenueCat SKU) */
function toServerPlanTier(tier, metadata) {
    if (tier === client_1.SubscriptionTier.PREMIUM) {
        if (metadata?.sku?.toLowerCase().includes('pro'))
            return 'PRO';
        return 'PREMIUM';
    }
    return 'FREE';
}
function isPaidTier(tier) {
    return tier === client_1.SubscriptionTier.PREMIUM;
}
function shouldServeAds(tier) {
    const plan = tier === client_1.SubscriptionTier.PREMIUM ? 'PREMIUM' : 'FREE';
    return (0, subscription_limits_1.getLimitsForTier)(plan).adsEnabled;
}
function getDailyAIQuota(tier) {
    const plan = tier === client_1.SubscriptionTier.PREMIUM ? 'PREMIUM' : 'FREE';
    return (0, subscription_limits_1.getLimitsForTier)(plan).maxAiPerDay;
}
function getMonthlyAIQuota(tier) {
    const plan = tier === client_1.SubscriptionTier.PREMIUM ? 'PREMIUM' : 'FREE';
    return (0, subscription_limits_1.getLimitsForTier)(plan).maxAiPerMonth;
}
