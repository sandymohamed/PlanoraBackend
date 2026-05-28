import { GeneratedPlan } from '../../shared/types';
import { logger } from '../../shared/utils/logger';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface CacheKeyInput {
  goal: string;
  durationDays: number;
  hoursPerDay: number;
}

interface CacheEntry {
  plan: GeneratedPlan;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Normalize goal text for stable cache keys */
export function generateCacheKey(input: CacheKeyInput): string {
  const goal = input.goal.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${goal}|${input.durationDays}|${input.hoursPerDay}`;
}

export function getCachedPlan(key: string): GeneratedPlan | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  logger.info('[AI CACHE HIT]', { key: key.substring(0, 80) });
  return entry.plan;
}

export function setCachedPlan(key: string, plan: GeneratedPlan): void {
  cache.set(key, {
    plan,
    expiresAt: Date.now() + TTL_MS,
  });
}

/** Test helper — clear in-memory cache */
export function clearAiPlanCache(): void {
  cache.clear();
}
