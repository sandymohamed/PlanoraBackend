import { logger } from '../../shared/utils/logger';

const DEFAULT_DAILY_LIMIT = 10;

interface UserDayCounter {
  count: number;
  dateKey: string; // YYYY-MM-DD UTC
}

const counters = new Map<string, UserDayCounter>();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDailyLimit(): number {
  const env = process.env.AI_DAILY_LIMIT_FREE;
  if (env) {
    const n = parseInt(env, 10);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  return DEFAULT_DAILY_LIMIT;
}

export interface LimitCheckResult {
  allowed: boolean;
  count: number;
  limit: number;
  forceOffline: boolean;
}

/**
 * Check whether the user may use online OpenAI for this request.
 * Increments counter only when `consume` is true (online attempt).
 */
export function checkAiDailyLimit(userId: string, consume = false): LimitCheckResult {
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
    logger.warn('[AI OFFLINE MODE USED] daily limit reached', {
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
export function resetAiLimits(): void {
  counters.clear();
}
