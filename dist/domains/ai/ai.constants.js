"use strict";
/**
 * Centralized AI tuning. Values are env-overridable so production can change
 * models/limits without code changes. Defaults target OpenRouter free tier.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_CONSTANTS = void 0;
function envInt(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? fallback : n;
}
function envFloat(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const n = parseFloat(raw);
    return Number.isNaN(n) ? fallback : n;
}
exports.AI_CONSTANTS = {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    // Free OpenRouter models — primary then fallback.
    primaryModel: process.env.OPENROUTER_MODEL_PRIMARY?.trim() || 'x-ai/grok-4.3',
    fallbackModel: process.env.OPENROUTER_MODEL_FALLBACK?.trim() || 'meta-llama/llama-3.3-70b-instruct',
    // OpenRouter attribution headers (optional, recommended).
    appName: process.env.OPENROUTER_APP_NAME?.trim() || 'Planora AI',
    siteUrl: process.env.OPENROUTER_SITE_URL?.trim() || '',
    requestTimeoutMs: envInt('OPENROUTER_TIMEOUT_MS', 20000),
    // Token optimization — keep outputs small and structured.
    planTemperature: envFloat('AI_PLAN_TEMPERATURE', 0.4),
    reviewTemperature: envFloat('AI_REVIEW_TEMPERATURE', 0.5),
    planMaxTokens: envInt('AI_PLAN_MAX_TOKENS', 1100),
    reviewMaxTokens: envInt('AI_REVIEW_MAX_TOKENS', 380),
    // Plan size caps (also enforced in prompt) to bound tokens & DB writes.
    maxMilestones: envInt('AI_MAX_MILESTONES', 6),
    maxTasksPerMilestone: envInt('AI_MAX_TASKS_PER_MILESTONE', 4),
};
