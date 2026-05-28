/**
 * Subscription & AI quota limits — single source for backend enforcement.
 * Align with PlanoraMobile/src/config/aiLimits.ts when changing tiers.
 */

export type ServerPlanTier = 'FREE' | 'PRO' | 'PREMIUM';

export const SUBSCRIPTION_LIMITS = {
  FREE: {
    maxActiveGoals: 3,
    maxAiPerMonth: 5,
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
} as const;

export function getLimitsForTier(tier: ServerPlanTier) {
  return SUBSCRIPTION_LIMITS[tier] ?? SUBSCRIPTION_LIMITS.FREE;
}
