import { logger } from '../../shared/utils/logger';

export type AIMode = 'cache' | 'online' | 'offline';

export interface StrategyContext {
  cacheHit: boolean;
  forceOffline: boolean;
  hasApiKey: boolean;
}

/**
 * Decide generation mode.
 * Priority when resolving next step: cache (caller) → offline if forced → online.
 */
export function resolveGenerationMode(ctx: StrategyContext): AIMode {
  if (ctx.cacheHit) {
    return 'cache';
  }
  if (ctx.forceOffline || !ctx.hasApiKey) {
    if (!ctx.hasApiKey) {
      logger.info('[AI OFFLINE MODE USED] no AI provider configured');
    }
    return 'offline';
  }
  return 'online';
}

export function computeDurationDays(targetDate: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(targetDate);
  if (Number.isNaN(target.getTime())) {
    return 30;
  }
  const diff = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return clamp(diff, 7, 365);
}

export function computeHoursPerDay(weeklyHours: number): number {
  return clamp(Math.round((weeklyHours / 7) * 10) / 10, 1, 12);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
