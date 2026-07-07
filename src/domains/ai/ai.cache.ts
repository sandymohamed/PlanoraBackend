import { logger } from '../../shared/utils/logger';
import { PlanGenerationResult } from './ai.generation.types';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface CacheKeyInput {
  goal: string;
  durationDays: number;
  hoursPerDay: number;
  /** Subscription tier — lets tiers receive different plans (defaults to free) */
  tier?: string;
  /** Goal category changes offline fallback shape and may influence future prompts. */
  category?: string;
}

interface CacheEntry {
  result: PlanGenerationResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Normalize goal text for stable cache keys.
 * Note: userId is intentionally excluded so identical goals are shared across
 * users — this maximizes cache hits and minimizes free-tier token usage.
 */
export function generateCacheKey(input: CacheKeyInput): string {
  const goal = input.goal.trim().toLowerCase().replace(/\s+/g, ' ');
  const tier = (input.tier ?? 'free').toLowerCase();
  const category = (input.category ?? 'general').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${goal}|${category}|${input.durationDays}|${input.hoursPerDay}|${tier}`;
}

export function getCachedPlan(key: string): PlanGenerationResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  logger.info('[AI CACHE HIT]', { key: key.substring(0, 80) });
  return entry.result;
}

export function setCachedPlan(key: string, result: PlanGenerationResult): void {
  cache.set(key, {
    result,
    expiresAt: Date.now() + TTL_MS,
  });
}

/** Test helper — clear in-memory cache */
export function clearAiPlanCache(): void {
  cache.clear();
}
