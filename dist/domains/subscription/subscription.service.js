"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptionService = exports.SubscriptionService = void 0;
const client_1 = require("@prisma/client");
const database_1 = require("../../shared/utils/database");
const env_1 = require("../../config/env");
const types_1 = require("../../shared/types");
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
        if (usage >= env_1.env.freemium.freeMaxAiPerMonth) {
            throw new types_1.AuthorizationError(`Free plan includes ${env_1.env.freemium.freeMaxAiPerMonth} AI generations per month. Upgrade for unlimited AI planning.`);
        }
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
