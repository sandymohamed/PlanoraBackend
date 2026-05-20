import { getPrismaClient } from '../../shared/utils/database';
import { aiService } from '../ai/ai.service';
import { subscriptionService } from '../subscription/subscription.service';
import { logger } from '../../shared/utils/logger';
import { startOfWeek, endOfWeek } from 'date-fns';

export class WeeklyReviewService {
  async generateForUser(userId: string, referenceDate = new Date()) {
    const prisma = getPrismaClient();
    const weekStart = startOfWeek(referenceDate, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(referenceDate, { weekStartsOn: 1 });

    const existing = await prisma.weeklyReview.findUnique({
      where: { userId_weekStart: { userId, weekStart } },
    });
    if (existing) return existing;

    const tasks = await prisma.task.findMany({
      where: {
        creatorId: userId,
        updatedAt: { gte: weekStart, lte: weekEnd },
      },
    });

    const completedTasks = tasks.filter((t) => t.status === 'DONE').length;
    const missedTasks = tasks.filter(
      (t) => t.status !== 'DONE' && t.dueDate && t.dueDate < weekEnd
    ).length;

    const routines = await prisma.routine.findMany({ where: { userId, enabled: true } });
    const routineTasks = await prisma.routineTask.findMany({
      where: { routineId: { in: routines.map((r) => r.id) } },
    });
    const routineCompleted = routineTasks.filter((t) => t.completed).length;
    const routineTotal = routineTasks.length || 1;
    const consistencyScore = Math.round(
      ((completedTasks + routineCompleted) / (tasks.length + routineTotal || 1)) * 100
    );

    const dayMap: Record<string, number> = {};
    tasks
      .filter((t) => t.completedAt)
      .forEach((t) => {
        const day = t.completedAt!.toISOString().slice(0, 10);
        dayMap[day] = (dayMap[day] || 0) + 1;
      });
    const bestDays = Object.entries(dayMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([date, count]) => ({ date, completed: count }));

    let insights: string[] = [];
    let recommendations: string[] = [];
    let shareableSummary = '';

    try {
      await subscriptionService.assertCanUseAI(userId);
      const plan = await aiService.generateWeeklyReview({
        completedTasks,
        missedTasks,
        consistencyScore,
        bestDays,
      });
      insights = plan.insights;
      recommendations = plan.recommendations;
      shareableSummary = plan.shareableSummary;
      await subscriptionService.logAIUsage(userId, 'weekly_review');
    } catch (e) {
      logger.warn('Weekly review AI fallback', e);
      insights = [
        consistencyScore >= 70
          ? 'Strong week — you showed up consistently.'
          : 'Every step counts. Small wins build momentum.',
      ];
      recommendations = [
        'Pick one priority task for tomorrow morning.',
        'Review your active routines and trim what feels heavy.',
      ];
      shareableSummary = `I completed ${completedTasks} tasks this week with ${consistencyScore}% consistency on Planora AI.`;
    }

    return prisma.weeklyReview.create({
      data: {
        userId,
        weekStart,
        weekEnd,
        completedTasks,
        missedTasks,
        consistencyScore,
        bestDays,
        insights,
        recommendations,
        shareableSummary,
      },
    });
  }

  async listForUser(userId: string, limit = 12) {
    const prisma = getPrismaClient();
    return prisma.weeklyReview.findMany({
      where: { userId },
      orderBy: { weekStart: 'desc' },
      take: limit,
    });
  }
}

export const weeklyReviewService = new WeeklyReviewService();
