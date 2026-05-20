"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.weeklyReviewService = exports.WeeklyReviewService = void 0;
const database_1 = require("../../shared/utils/database");
const ai_service_1 = require("../ai/ai.service");
const subscription_service_1 = require("../subscription/subscription.service");
const logger_1 = require("../../shared/utils/logger");
const date_fns_1 = require("date-fns");
class WeeklyReviewService {
    async generateForUser(userId, referenceDate = new Date()) {
        const prisma = (0, database_1.getPrismaClient)();
        const weekStart = (0, date_fns_1.startOfWeek)(referenceDate, { weekStartsOn: 1 });
        const weekEnd = (0, date_fns_1.endOfWeek)(referenceDate, { weekStartsOn: 1 });
        const existing = await prisma.weeklyReview.findUnique({
            where: { userId_weekStart: { userId, weekStart } },
        });
        if (existing)
            return existing;
        const tasks = await prisma.task.findMany({
            where: {
                creatorId: userId,
                updatedAt: { gte: weekStart, lte: weekEnd },
            },
        });
        const completedTasks = tasks.filter((t) => t.status === 'DONE').length;
        const missedTasks = tasks.filter((t) => t.status !== 'DONE' && t.dueDate && t.dueDate < weekEnd).length;
        const routines = await prisma.routine.findMany({ where: { userId, enabled: true } });
        const routineTasks = await prisma.routineTask.findMany({
            where: { routineId: { in: routines.map((r) => r.id) } },
        });
        const routineCompleted = routineTasks.filter((t) => t.completed).length;
        const routineTotal = routineTasks.length || 1;
        const consistencyScore = Math.round(((completedTasks + routineCompleted) / (tasks.length + routineTotal || 1)) * 100);
        const dayMap = {};
        tasks
            .filter((t) => t.completedAt)
            .forEach((t) => {
            const day = t.completedAt.toISOString().slice(0, 10);
            dayMap[day] = (dayMap[day] || 0) + 1;
        });
        const bestDays = Object.entries(dayMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([date, count]) => ({ date, completed: count }));
        let insights = [];
        let recommendations = [];
        let shareableSummary = '';
        try {
            await subscription_service_1.subscriptionService.assertCanUseAI(userId);
            const plan = await ai_service_1.aiService.generateWeeklyReview({
                completedTasks,
                missedTasks,
                consistencyScore,
                bestDays,
            });
            insights = plan.insights;
            recommendations = plan.recommendations;
            shareableSummary = plan.shareableSummary;
            await subscription_service_1.subscriptionService.logAIUsage(userId, 'weekly_review');
        }
        catch (e) {
            logger_1.logger.warn('Weekly review AI fallback', e);
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
    async listForUser(userId, limit = 12) {
        const prisma = (0, database_1.getPrismaClient)();
        return prisma.weeklyReview.findMany({
            where: { userId },
            orderBy: { weekStart: 'desc' },
            take: limit,
        });
    }
}
exports.WeeklyReviewService = WeeklyReviewService;
exports.weeklyReviewService = new WeeklyReviewService();
