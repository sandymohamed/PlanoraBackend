"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiService = void 0;
const logger_1 = require("../../shared/utils/logger");
const sentry_1 = require("../../infrastructure/sentry/sentry");
const ai_cache_1 = require("./ai.cache");
const ai_limits_1 = require("./ai.limits");
const ai_offline_1 = require("./ai.offline");
const ai_strategy_1 = require("./ai.strategy");
const provider_factory_1 = require("./providers/provider.factory");
const ai_prompts_1 = require("./ai.prompts");
const ai_constants_1 = require("./ai.constants");
const provider_types_1 = require("./providers/provider.types");
function classifyFallbackReason(error) {
    if (error instanceof provider_types_1.AIProviderError) {
        if (error.status === 429)
            return 'PROVIDER_RATE_LIMITED';
        if (error.status && error.status >= 500)
            return 'PROVIDER_5XX';
        if (error.status && error.status >= 400)
            return 'PROVIDER_4XX';
    }
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    if (lower.includes('timeout') || lower.includes('timed out'))
        return 'PROVIDER_TIMEOUT';
    if (lower.includes('empty response'))
        return 'PROVIDER_EMPTY_RESPONSE';
    if (lower.includes('invalid json') || lower.includes('invalid response format'))
        return 'PROVIDER_INVALID_JSON';
    if (lower.includes('not configured') || lower.includes('api key'))
        return 'PROVIDER_DISABLED';
    return 'UNKNOWN_PROVIDER_ERROR';
}
function sentryContext(input) {
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
    static getInstance() {
        if (!AIService.instance) {
            AIService.instance = new AIService();
        }
        return AIService.instance;
    }
    /**
     * Hybrid plan generation: cache → provider (if allowed) → offline fallback.
     * Always returns a plan; never throws on provider quota/network failures.
     */
    async generatePlan(goalTitle, goalDescription, targetDate, options = {}, userId) {
        const startedAt = Date.now();
        const weeklyHours = options.weeklyHours ?? 10;
        const durationDays = (0, ai_strategy_1.computeDurationDays)(targetDate);
        const hoursPerDay = (0, ai_strategy_1.computeHoursPerDay)(weeklyHours);
        const goal = goalTitle.trim() || 'Goal';
        const category = options.category?.trim() || 'General';
        const tier = options.tier ?? 'free';
        const cacheKey = (0, ai_cache_1.generateCacheKey)({ goal, category, durationDays, hoursPerDay, tier });
        const cached = (0, ai_cache_1.getCachedPlan)(cacheKey);
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
        const limit = userId ? (0, ai_limits_1.checkAiDailyLimit)(userId, false) : { forceOffline: false, allowed: true, count: 0, limit: 10 };
        const provider = (0, provider_factory_1.getAIProvider)();
        const mode = (0, ai_strategy_1.resolveGenerationMode)({
            cacheHit: false,
            forceOffline: limit.forceOffline,
            hasApiKey: provider !== null,
        });
        if (mode === 'offline') {
            // Offline plans are deterministic and cheap — intentionally not cached so
            // the next request can use the provider once quota/availability returns.
            const fallbackReason = provider === null ? 'PROVIDER_DISABLED' : 'DAILY_ONLINE_LIMIT_REACHED';
            const durationMs = Date.now() - startedAt;
            (0, sentry_1.captureMessage)('AI generation used offline template intentionally', sentryContext({
                provider: 'none',
                model: undefined,
                category,
                goalId: options.goalId,
                userId,
                durationMs,
                fallbackReason,
            }));
            return {
                plan: (0, ai_offline_1.generateOfflinePlan)({ goal, description: goalDescription, category, durationDays, hoursPerDay }),
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
                (0, ai_limits_1.checkAiDailyLimit)(userId, true);
            }
            const result = await this.generatePlanOnline({
                goal,
                durationDays,
                hoursPerDay,
                language: options.language ?? 'en',
            });
            const durationMs = Date.now() - startedAt;
            const generationResult = {
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
            (0, ai_cache_1.setCachedPlan)(cacheKey, generationResult);
            return generationResult;
        }
        catch (error) {
            const fallbackReason = classifyFallbackReason(error);
            const durationMs = Date.now() - startedAt;
            logger_1.logger.warn('[AI FALLBACK TRIGGERED]', {
                error: error instanceof Error ? error.message : String(error),
                goal: goal.substring(0, 60),
                fallbackReason,
            });
            (0, sentry_1.captureException)(error, sentryContext({
                provider: 'openrouter',
                model: ai_constants_1.AI_CONSTANTS.primaryModel,
                category,
                goalId: options.goalId,
                userId,
                durationMs,
                fallbackReason,
                error,
            }));
            return {
                plan: (0, ai_offline_1.generateOfflinePlan)({ goal, description: goalDescription, category, durationDays, hoursPerDay }),
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
    async generatePlanOnline(input) {
        const provider = (0, provider_factory_1.getAIProvider)();
        if (!provider) {
            throw new Error('No AI provider configured');
        }
        const result = await provider.createChatCompletion({
            messages: (0, ai_prompts_1.buildPlanMessages)(input),
            temperature: ai_constants_1.AI_CONSTANTS.planTemperature,
            maxTokens: ai_constants_1.AI_CONSTANTS.planMaxTokens,
            jsonMode: true,
        });
        const plan = this.parseResponse(result.content);
        logger_1.logger.info('[AI PROVIDER SUCCESS]', {
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
    parseResponse(content) {
        try {
            let jsonString = '';
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                jsonString = jsonMatch[0];
            }
            else {
                const arrayMatch = content.match(/\[[\s\S]*\]/);
                if (arrayMatch) {
                    jsonString = `{"data": ${arrayMatch[0]}}`;
                }
                else {
                    throw new Error('No JSON found in response');
                }
            }
            let cleanedJson = jsonString.replace(/,(\s*[}\]])/g, '$1').replace(/'/g, '"');
            let parsed;
            try {
                parsed = JSON.parse(cleanedJson);
            }
            catch {
                parsed = JSON.parse(jsonString);
            }
            return {
                milestones: this.validateMilestones(parsed.milestones || parsed.data?.milestones || []),
                tasks: this.validateTasks(parsed.tasks || parsed.data?.tasks || []),
                notes: parsed.notes || parsed.data?.notes || '',
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to parse AI response:', error);
            throw new Error(`Invalid response format from AI: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    validateMilestones(milestones) {
        return milestones.map((milestone, index) => ({
            title: milestone.title || `Milestone ${index + 1}`,
            durationDays: Math.max(1, parseInt(milestone.duration_days) || 7),
            targetDate: milestone.target_date || milestone.targetDate || undefined,
            description: milestone.description || '',
            tasks: milestone.tasks || [],
        }));
    }
    validateTasks(tasks) {
        return tasks.map((task, index) => ({
            title: task.title || `Task ${index + 1}`,
            milestoneIndex: Math.max(0, parseInt(task.milestone_index) || 0),
            dueOffsetDays: Math.max(0, parseInt(task.due_offset_days) || 1),
            durationMinutes: Math.max(15, parseInt(task.duration_minutes) || 60),
            recurrence: task.recurrence || null,
            description: task.description || '',
        }));
    }
    async generateSimplePlan(goalTitle) {
        return (0, ai_offline_1.generateOfflinePlan)({
            goal: goalTitle,
            durationDays: 21,
            hoursPerDay: 1.5,
        });
    }
    /** Motivational weekly review copy for shareable cards */
    async generateWeeklyReview(stats) {
        const fallback = {
            insights: ['You showed up this week — that matters.'],
            recommendations: ['Choose one focus block tomorrow morning.'],
            shareableSummary: `${stats.consistencyScore}% consistency this week on Planora AI.`,
        };
        const provider = (0, provider_factory_1.getAIProvider)();
        if (!provider) {
            logger_1.logger.info('[AI OFFLINE MODE USED]', { feature: 'weeklyReview', reason: 'no provider' });
            return fallback;
        }
        try {
            const result = await provider.createChatCompletion({
                messages: (0, ai_prompts_1.buildWeeklyReviewMessages)(stats),
                temperature: ai_constants_1.AI_CONSTANTS.reviewTemperature,
                maxTokens: ai_constants_1.AI_CONSTANTS.reviewMaxTokens,
                jsonMode: true,
            });
            const cleaned = result.content.replace(/```json|```/g, '').trim();
            const match = cleaned.match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(match ? match[0] : cleaned);
            logger_1.logger.info('[AI PROVIDER SUCCESS]', {
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
                shareableSummary: typeof parsed.shareableSummary === 'string' && parsed.shareableSummary.trim()
                    ? parsed.shareableSummary
                    : fallback.shareableSummary,
            };
        }
        catch (error) {
            logger_1.logger.warn('[AI FALLBACK TRIGGERED]', {
                feature: 'weeklyReview',
                error: error instanceof Error ? error.message : String(error),
            });
            return fallback;
        }
    }
}
exports.aiService = AIService.getInstance();
