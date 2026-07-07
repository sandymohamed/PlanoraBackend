import { logger } from '../../shared/utils/logger';
import { GeneratedPlan, GeneratedMilestone, GeneratedTask } from '../../shared/types';
import { captureException, captureMessage } from '../../infrastructure/sentry/sentry';
import { generateCacheKey, getCachedPlan, setCachedPlan } from './ai.cache';
import { checkAiDailyLimit } from './ai.limits';
import { generateOfflinePlan } from './ai.offline';
import { PlanGenerationResult } from './ai.generation.types';
import {
  computeDurationDays,
  computeHoursPerDay,
  resolveGenerationMode,
} from './ai.strategy';
import { getAIProvider } from './providers/provider.factory';
import { buildPlanMessages, buildWeeklyReviewMessages } from './ai.prompts';
import { AI_CONSTANTS } from './ai.constants';
import { AIProviderError, ChatCompletionResult } from './providers/provider.types';

function classifyFallbackReason(error: unknown): string {
  if (error instanceof AIProviderError) {
    if (error.status === 429) return 'PROVIDER_RATE_LIMITED';
    if (error.status && error.status >= 500) return 'PROVIDER_5XX';
    if (error.status && error.status >= 400) return 'PROVIDER_4XX';
  }

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('timeout') || lower.includes('timed out')) return 'PROVIDER_TIMEOUT';
  if (lower.includes('empty response')) return 'PROVIDER_EMPTY_RESPONSE';
  if (lower.includes('invalid json') || lower.includes('invalid response format')) return 'PROVIDER_INVALID_JSON';
  if (lower.includes('not configured') || lower.includes('api key')) return 'PROVIDER_DISABLED';
  return 'UNKNOWN_PROVIDER_ERROR';
}

function sentryContext(input: {
  provider: string;
  model?: string;
  category: string;
  goalId?: string;
  userId?: string;
  durationMs: number;
  fallbackReason: string;
  error?: unknown;
}) {
  return {
    tags: {
      feature: 'ai_generation',
      provider: input.provider,
      model: input.model,
      category: input.category,
    },
    extra: {
      goalId: input.goalId,
      userId: input.userId,
      duration: input.durationMs,
      errorType: input.error instanceof Error ? input.error.name : undefined,
      fallbackReason: input.fallbackReason,
    },
  };
}

class AIService {
  private static instance: AIService;

  static getInstance(): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService();
    }
    return AIService.instance;
  }

  /**
   * Hybrid plan generation: cache → provider (if allowed) → offline fallback.
   * Always returns a plan; never throws on provider quota/network failures.
   */
  async generatePlan(
    goalTitle: string,
    goalDescription: string,
    targetDate: string,
    options: {
      intensity?: 'low' | 'medium' | 'high';
      weeklyHours?: number;
      language?: 'en' | 'ar';
      tone?: 'supportive' | 'professional' | 'casual';
      category?: string;
      goalId?: string;
      /** Subscription tier — part of the cache key (defaults to free) */
      tier?: string;
    } = {},
    userId?: string
  ): Promise<PlanGenerationResult> {
    const startedAt = Date.now();
    const weeklyHours = options.weeklyHours ?? 10;
    const durationDays = computeDurationDays(targetDate);
    const hoursPerDay = computeHoursPerDay(weeklyHours);
    const goal = goalTitle.trim() || 'Goal';
    const category = options.category?.trim() || 'General';
    const tier = options.tier ?? 'free';

    const cacheKey = generateCacheKey({ goal, category, durationDays, hoursPerDay, tier });
    const cached = getCachedPlan(cacheKey);
    if (cached) {
      return {
        plan: cached.plan,
        metadata: {
          ...cached.metadata,
          cacheHit: true,
          quotaConsumed: false,
          durationMs: Date.now() - startedAt,
        },
      };
    }

    const limit = userId ? checkAiDailyLimit(userId, false) : { forceOffline: false, allowed: true, count: 0, limit: 10 };
    const provider = getAIProvider();
    const mode = resolveGenerationMode({
      cacheHit: false,
      forceOffline: limit.forceOffline,
      hasApiKey: provider !== null,
    });

    if (mode === 'offline') {
      // Offline plans are deterministic and cheap — intentionally not cached so
      // the next request can use the provider once quota/availability returns.
      const fallbackReason = provider === null ? 'PROVIDER_DISABLED' : 'DAILY_ONLINE_LIMIT_REACHED';
      const durationMs = Date.now() - startedAt;
      captureMessage('AI generation used offline template intentionally', sentryContext({
        provider: 'none',
        model: undefined,
        category,
        goalId: options.goalId,
        userId,
        durationMs,
        fallbackReason,
      }));
      return {
        plan: generateOfflinePlan({ goal, description: goalDescription, category, durationDays, hoursPerDay }),
        metadata: {
          source: 'OFFLINE_TEMPLATE',
          provider: 'none',
          fallback: true,
          fallbackReason,
          quotaConsumed: false,
          durationMs,
          cacheHit: false,
          status: 'FALLBACK_SUCCESS',
        },
      };
    }

    try {
      if (userId) {
        checkAiDailyLimit(userId, true);
      }
      const result = await this.generatePlanOnline({
        goal,
        durationDays,
        hoursPerDay,
        language: options.language ?? 'en',
      });
      const durationMs = Date.now() - startedAt;
      const generationResult: PlanGenerationResult = {
        plan: result.plan,
        metadata: {
          source: 'AI',
          provider: 'openrouter',
          model: result.provider.model,
          fallback: false,
          quotaConsumed: true,
          durationMs,
          cacheHit: false,
          status: 'SUCCESS',
        },
      };
      // Cache successful provider responses only.
      setCachedPlan(cacheKey, generationResult);
      return generationResult;
    } catch (error) {
      const fallbackReason = classifyFallbackReason(error);
      const durationMs = Date.now() - startedAt;
      logger.warn('[AI FALLBACK TRIGGERED]', {
        error: error instanceof Error ? error.message : String(error),
        goal: goal.substring(0, 60),
        fallbackReason,
      });
      captureException(error, sentryContext({
        provider: 'openrouter',
        model: AI_CONSTANTS.primaryModel,
        category,
        goalId: options.goalId,
        userId,
        durationMs,
        fallbackReason,
        error,
      }));
      return {
        plan: generateOfflinePlan({ goal, description: goalDescription, category, durationDays, hoursPerDay }),
        metadata: {
          source: 'OFFLINE_TEMPLATE',
          provider: 'none',
          fallback: true,
          fallbackReason,
          quotaConsumed: false,
          durationMs,
          cacheHit: false,
          status: 'FALLBACK_SUCCESS',
        },
      };
    }
  }

  /** Minimal-token provider call — only goal, duration, hoursPerDay. */
  private async generatePlanOnline(input: {
    goal: string;
    durationDays: number;
    hoursPerDay: number;
    language: string;
  }): Promise<{ plan: GeneratedPlan; provider: ChatCompletionResult }> {
    const provider = getAIProvider();
    if (!provider) {
      throw new Error('No AI provider configured');
    }

    const result = await provider.createChatCompletion({
      messages: buildPlanMessages(input),
      temperature: AI_CONSTANTS.planTemperature,
      maxTokens: AI_CONSTANTS.planMaxTokens,
      jsonMode: true,
    });

    const plan = this.parseResponse(result.content);

    logger.info('[AI PROVIDER SUCCESS]', {
      provider: result.provider,
      model: result.model,
      fallbackUsed: result.fallbackUsed,
      latencyMs: result.latencyMs,
      totalTokens: result.usage?.totalTokens,
      goal: input.goal.substring(0, 60),
      durationDays: input.durationDays,
      hoursPerDay: input.hoursPerDay,
    });

    return { plan, provider: result };
  }

  private parseResponse(content: string): GeneratedPlan {
    try {
      let jsonString = '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonString = jsonMatch[0];
      } else {
        const arrayMatch = content.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          jsonString = `{"data": ${arrayMatch[0]}}`;
        } else {
          throw new Error('No JSON found in response');
        }
      }

      let cleanedJson = jsonString.replace(/,(\s*[}\]])/g, '$1').replace(/'/g, '"');

      let parsed;
      try {
        parsed = JSON.parse(cleanedJson);
      } catch {
        parsed = JSON.parse(jsonString);
      }

      return {
        milestones: this.validateMilestones(parsed.milestones || parsed.data?.milestones || []),
        tasks: this.validateTasks(parsed.tasks || parsed.data?.tasks || []),
        notes: parsed.notes || parsed.data?.notes || '',
      };
    } catch (error) {
      logger.error('Failed to parse AI response:', error);
      throw new Error(
        `Invalid response format from AI: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private validateMilestones(milestones: any[]): GeneratedMilestone[] {
    return milestones.map((milestone, index) => ({
      title: milestone.title || `Milestone ${index + 1}`,
      durationDays: Math.max(1, parseInt(milestone.duration_days) || 7),
      targetDate: milestone.target_date || milestone.targetDate || undefined,
      description: milestone.description || '',
      tasks: milestone.tasks || [],
    }));
  }

  private validateTasks(tasks: any[]): GeneratedTask[] {
    return tasks.map((task, index) => ({
      title: task.title || `Task ${index + 1}`,
      milestoneIndex: Math.max(0, parseInt(task.milestone_index) || 0),
      dueOffsetDays: Math.max(0, parseInt(task.due_offset_days) || 1),
      durationMinutes: Math.max(15, parseInt(task.duration_minutes) || 60),
      recurrence: task.recurrence || null,
      description: task.description || '',
    }));
  }

  async generateSimplePlan(goalTitle: string): Promise<GeneratedPlan> {
    return generateOfflinePlan({
      goal: goalTitle,
      durationDays: 21,
      hoursPerDay: 1.5,
    });
  }

  /** Motivational weekly review copy for shareable cards */
  async generateWeeklyReview(stats: {
    completedTasks: number;
    missedTasks: number;
    consistencyScore: number;
    bestDays: { date: string; completed: number }[];
  }): Promise<{
    insights: string[];
    recommendations: string[];
    shareableSummary: string;
  }> {
    const fallback = {
      insights: ['You showed up this week — that matters.'],
      recommendations: ['Choose one focus block tomorrow morning.'],
      shareableSummary: `${stats.consistencyScore}% consistency this week on Planora AI.`,
    };

    const provider = getAIProvider();
    if (!provider) {
      logger.info('[AI OFFLINE MODE USED]', { feature: 'weeklyReview', reason: 'no provider' });
      return fallback;
    }

    try {
      const result = await provider.createChatCompletion({
        messages: buildWeeklyReviewMessages(stats),
        temperature: AI_CONSTANTS.reviewTemperature,
        maxTokens: AI_CONSTANTS.reviewMaxTokens,
        jsonMode: true,
      });

      const cleaned = result.content.replace(/```json|```/g, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match ? match[0] : cleaned);

      logger.info('[AI PROVIDER SUCCESS]', {
        feature: 'weeklyReview',
        provider: result.provider,
        model: result.model,
        fallbackUsed: result.fallbackUsed,
        latencyMs: result.latencyMs,
      });

      return {
        insights: Array.isArray(parsed.insights) ? parsed.insights : fallback.insights,
        recommendations: Array.isArray(parsed.recommendations)
          ? parsed.recommendations
          : fallback.recommendations,
        shareableSummary:
          typeof parsed.shareableSummary === 'string' && parsed.shareableSummary.trim()
            ? parsed.shareableSummary
            : fallback.shareableSummary,
      };
    } catch (error) {
      logger.warn('[AI FALLBACK TRIGGERED]', {
        feature: 'weeklyReview',
        error: error instanceof Error ? error.message : String(error),
      });
      return fallback;
    }
  }
}

export const aiService = AIService.getInstance();
