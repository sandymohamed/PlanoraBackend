import { SubscriptionTier } from '@prisma/client';
import { getLimitsForTier, ServerPlanTier, SUBSCRIPTION_LIMITS } from './subscription.limits';

export { getLimitsForTier, SUBSCRIPTION_LIMITS };

/** Map Prisma tier to extended plan (PRO reserved for future RevenueCat SKU) */
export function toServerPlanTier(tier: SubscriptionTier, metadata?: { sku?: string }): ServerPlanTier {
  if (tier === SubscriptionTier.PREMIUM) {
    if (metadata?.sku?.toLowerCase().includes('pro')) return 'PRO';
    return 'PREMIUM';
  }
  return 'FREE';
}

export function isPaidTier(tier: SubscriptionTier): boolean {
  return tier === SubscriptionTier.PREMIUM;
}

export function shouldServeAds(tier: SubscriptionTier): boolean {
  const plan = tier === SubscriptionTier.PREMIUM ? 'PREMIUM' : 'FREE';
  return getLimitsForTier(plan).adsEnabled;
}

export function getDailyAIQuota(tier: SubscriptionTier): number {
  const plan: ServerPlanTier = tier === SubscriptionTier.PREMIUM ? 'PREMIUM' : 'FREE';
  return getLimitsForTier(plan).maxAiPerDay;
}

export function getMonthlyAIQuota(tier: SubscriptionTier): number {
  const plan: ServerPlanTier = tier === SubscriptionTier.PREMIUM ? 'PREMIUM' : 'FREE';
  return getLimitsForTier(plan).maxAiPerMonth;
}
