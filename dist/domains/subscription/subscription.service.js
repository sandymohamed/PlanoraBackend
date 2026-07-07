"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptionService = exports.SubscriptionService = void 0;
const client_1 = require("@prisma/client");
const database_1 = require("../../shared/utils/database");
const env_1 = require("../../config/env");
const types_1 = require("../../shared/types");
const subscription_planHelpers_1 = require("./subscription.planHelpers");
class SubscriptionService {
    async getOrCreate(userId) {
        const prisma = (0, database_1.getPrismaClient)();
        let sub = await prisma.userSubscription.findUnique({ where: { userId } });
        if (!sub) {
            sub = await prisma.userSubscription.create({
                data: { userId, tier: client_1.SubscriptionTier.FREE },
            });
        }
        return sub;
    }
    isPremium(tier) {
        return tier === client_1.SubscriptionTier.PREMIUM;
    }
    async assertCanCreateGoal(userId) {
        const sub = await this.getOrCreate(userId);
        if (this.isPremium(sub.tier))
            return;
        const prisma = (0, database_1.getPrismaClient)();
        const activeGoals = await prisma.goal.count({
            where: {
                userId,
                status: { in: ['ACTIVE', 'DRAFT'] },
            },
        });
        if (activeGoals >= env_1.env.freemium.freeMaxActiveGoals) {
            throw new types_1.AuthorizationError(`Free plan allows up to ${env_1.env.freemium.freeMaxActiveGoals} active goals. Upgrade to Premium for unlimited goals.`);
        }
    }
    async assertCanUseAI(userId) {
        const sub = await this.getOrCreate(userId);
        if (this.isPremium(sub.tier))
            return;
        const prisma = (0, database_1.getPrismaClient)();
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        const usage = await prisma.aIUsageLog.count({
            where: { userId, createdAt: { gte: startOfMonth } },
        });
        const limit = env_1.env.freemium.freeMaxAiPerMonth || (0, subscription_planHelpers_1.getMonthlyAIQuota)(sub.tier);
        if (usage >= limit) {
            throw new types_1.AuthorizationError(`Free plan includes ${limit} AI generations per month. Upgrade for unlimited AI planning.`);
        }
    }
    /** Daily AI quota helper for future per-day enforcement */
    getAIQuotaForUser(tier) {
        const plan = tier === client_1.SubscriptionTier.PREMIUM ? 'PREMIUM' : 'FREE';
        return (0, subscription_planHelpers_1.getLimitsForTier)(plan);
    }
    /**
     * Monthly AI usage snapshot for the current calendar month.
     * Premium users are effectively unlimited (`limit`/`remaining` = null).
     */
    async getAIUsage(userId) {
        const sub = await this.getOrCreate(userId);
        const prisma = (0, database_1.getPrismaClient)();
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        const resetsAt = new Date(startOfMonth);
        resetsAt.setMonth(resetsAt.getMonth() + 1);
        const used = await prisma.aIUsageLog.count({
            where: { userId, createdAt: { gte: startOfMonth } },
        });
        if (this.isPremium(sub.tier)) {
            return { isPremium: true, used, limit: null, remaining: null, resetsAt: resetsAt.toISOString() };
        }
        const limit = env_1.env.freemium.freeMaxAiPerMonth || (0, subscription_planHelpers_1.getMonthlyAIQuota)(sub.tier);
        return {
            isPremium: false,
            used,
            limit,
            remaining: Math.max(0, limit - used),
            resetsAt: resetsAt.toISOString(),
        };
    }
    async logAIUsage(userId, action, tokens) {
        const prisma = (0, database_1.getPrismaClient)();
        await prisma.aIUsageLog.create({
            data: { userId, action, tokens: tokens ?? null },
        });
    }
}
exports.SubscriptionService = SubscriptionService;
exports.subscriptionService = new SubscriptionService();
