import { SubscriptionTier } from '@prisma/client';
import { getPrismaClient } from '../../shared/utils/database';
import { env } from '../../config/env';
import { AuthorizationError } from '../../shared/types';

export class SubscriptionService {
  async getOrCreate(userId: string) {
    const prisma = getPrismaClient();
    let sub = await prisma.userSubscription.findUnique({ where: { userId } });
    if (!sub) {
      sub = await prisma.userSubscription.create({
        data: { userId, tier: SubscriptionTier.FREE },
      });
    }
    return sub;
  }

  isPremium(tier: SubscriptionTier): boolean {
    return tier === SubscriptionTier.PREMIUM;
  }

  async assertCanCreateGoal(userId: string): Promise<void> {
    const sub = await this.getOrCreate(userId);
    if (this.isPremium(sub.tier)) return;

    const prisma = getPrismaClient();
    const activeGoals = await prisma.goal.count({
      where: {
        userId,
        status: { in: ['ACTIVE', 'DRAFT'] },
      },
    });

    if (activeGoals >= env.freemium.freeMaxActiveGoals) {
      throw new AuthorizationError(
        `Free plan allows up to ${env.freemium.freeMaxActiveGoals} active goals. Upgrade to Premium for unlimited goals.`
      );
    }
  }

  async assertCanUseAI(userId: string): Promise<void> {
    const sub = await this.getOrCreate(userId);
    if (this.isPremium(sub.tier)) return;

    const prisma = getPrismaClient();
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const usage = await prisma.aIUsageLog.count({
      where: { userId, createdAt: { gte: startOfMonth } },
    });

    if (usage >= env.freemium.freeMaxAiPerMonth) {
      throw new AuthorizationError(
        `Free plan includes ${env.freemium.freeMaxAiPerMonth} AI generations per month. Upgrade for unlimited AI planning.`
      );
    }
  }

  async logAIUsage(userId: string, action: string, tokens?: number): Promise<void> {
    const prisma = getPrismaClient();
    await prisma.aIUsageLog.create({
      data: { userId, action, tokens: tokens ?? null },
    });
  }
}

export const subscriptionService = new SubscriptionService();
