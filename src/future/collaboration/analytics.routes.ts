import { Router, Response } from 'express';
import Joi from 'joi';
import { getPrismaClient } from '../../shared/utils/database';
import { authenticateToken } from '../../shared/middleware/auth';
import { AuthenticatedRequest, ValidationError } from '../../shared/types';
import { logger } from '../../shared/utils/logger';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

const analyticsQuerySchema = Joi.object({
  period: Joi.string().valid('7d', '30d', '90d', '1y').optional(),
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional(),
});

// GET /api/v1/analytics/summary
router.get('/summary', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error, value } = analyticsQuerySchema.validate(req.query);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { period = '30d', startDate, endDate } = value;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Calculate date range
    const now = new Date();
    let dateFrom: Date;

    if (startDate && endDate) {
      dateFrom = new Date(startDate);
    } else {
      switch (period) {
        case '7d':
          dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case '90d':
          dateFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case '1y':
          dateFrom = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        default:
          dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }
    }

    const dateTo = endDate ? new Date(endDate) : now;

    // Get task statistics
    const [
      tasksCompleted,
      tasksCreated,
      goalsCompleted,
      goalsCreated,
      totalTasks,
    ] = await Promise.all([
      prisma.task.count({
        where: {
          OR: [
            { creatorId: userId },
            { assigneeId: userId },
            { project: { members: { some: { userId } } } },
          ],
          status: 'DONE',
          updatedAt: { gte: dateFrom, lte: dateTo },
        },
      }),
      prisma.task.count({
        where: {
          OR: [
            { creatorId: userId },
            { assigneeId: userId },
            { project: { members: { some: { userId } } } },
          ],
          createdAt: { gte: dateFrom, lte: dateTo },
        },
      }),
      prisma.goal.count({
        where: {
          userId,
          // status: 'DONE',
          planGenerated: true,
          updatedAt: { gte: dateFrom, lte: dateTo },
        },
      }),
      prisma.goal.count({
        where: {
          userId,
          createdAt: { gte: dateFrom, lte: dateTo },
        },
      }),
      prisma.task.count({
        where: {
          OR: [
            { creatorId: userId },
            { assigneeId: userId },
            { project: { members: { some: { userId } } } },
          ],
        },
      }),
    ]);

    // Calculate productivity score
    const productivityScore = totalTasks > 0 ? Math.round((tasksCompleted / totalTasks) * 100) : 0;

    // Get average task completion time (mock data for now)
    const averageTaskCompletionTime = 2.5; // hours

    // Get most productive day and time (mock data for now)
    const mostProductiveDay = 'Tuesday';
    const mostProductiveTime = '10:00';

    // Get category breakdown
    const categoryBreakdown = await prisma.task.groupBy({
      by: ['priority'],
      where: {
        OR: [
          { creatorId: userId },
          { assigneeId: userId },
          { project: { members: { some: { userId } } } },
        ],
        createdAt: { gte: dateFrom, lte: dateTo },
      },
      _count: {
        priority: true,
      },
    });

    const totalTasksInPeriod = categoryBreakdown.reduce((sum, item) => sum + item._count.priority, 0);

    const categoryBreakdownFormatted = categoryBreakdown.map((item) => ({
      category: item.priority,
      count: item._count.priority,
      percentage: totalTasksInPeriod > 0 ? Math.round((item._count.priority / totalTasksInPeriod) * 100) : 0,
    }));

    const analyticsSummary = {
      period,
      tasksCompleted,
      tasksCreated,
      goalsCompleted,
      goalsCreated,
      productivityScore,
      averageTaskCompletionTime,
      mostProductiveDay,
      mostProductiveTime,
      categoryBreakdown: categoryBreakdownFormatted,
    };

    res.json({
      success: true,
      data: analyticsSummary,
    });
  } catch (error) {
    logger.error('Failed to get analytics summary:', error);
    throw error;
  }
});

// GET /api/v1/analytics/productivity
router.get('/productivity', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { period = '30d' } = req.query;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Calculate date range
    const now = new Date();
    let dateFrom: Date;

    switch (period) {
      case '7d':
        dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        dateFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        dateFrom = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get daily productivity data
    const dailyProductivity = await prisma.task.groupBy({
      by: ['createdAt'],
      where: {
        OR: [
          { creatorId: userId },
          { assigneeId: userId },
          { project: { members: { some: { userId } } } },
        ],
        createdAt: { gte: dateFrom, lte: now },
        status: 'DONE',
      },
      _count: {
        id: true,
      },
    });

    // Format data for charts
    const productivityData = dailyProductivity.map((item) => ({
      date: item.createdAt.toISOString().split('T')[0],
      completed: item._count.id,
    }));

    res.json({
      success: true,
      data: {
        period,
        dailyProductivity: productivityData,
      },
    });
  } catch (error) {
    logger.error('Failed to get productivity data:', error);
    throw error;
  }
});

// GET /api/v1/analytics/goals
router.get('/goals', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { period = '30d' } = req.query;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Calculate date range
    const now = new Date();
    let dateFrom: Date;

    switch (period) {
      case '7d':
        dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        dateFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        dateFrom = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get goal progress data
    const goals = await prisma.goal.findMany({
      where: {
        userId,
        createdAt: { gte: dateFrom, lte: now },
      },
      include: {
        milestones: true,
        _count: {
          select: { milestones: true, tasks: true },
        },
      },
    });

    const goalProgress = goals.map((goal) => {
      const completedMilestones = goal.milestones.filter((m) => m.status === 'DONE').length;
      const totalMilestones = goal.milestones.length;
      const progressPercentage = totalMilestones > 0 ? Math.round((completedMilestones / totalMilestones) * 100) : 0;

      return {
        id: goal.id,
        title: goal.title,
        progress: progressPercentage,
        completedMilestones,
        totalMilestones,
        createdAt: goal.createdAt,
        targetDate: goal.targetDate,
      };
    });

    res.json({
      success: true,
      data: {
        period,
        goals: goalProgress,
      },
    });
  } catch (error) {
    logger.error('Failed to get goal analytics:', error);
    throw error;
  }
});

// GET /api/v1/analytics/tasks
router.get('/tasks', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { period = '30d' } = req.query;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Calculate date range
    const now = new Date();
    let dateFrom: Date;

    switch (period) {
      case '7d':
        dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        dateFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        dateFrom = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get task completion trends
    const taskTrends = await prisma.task.groupBy({
      by: ['status', 'priority'],
      where: {
        OR: [
          { creatorId: userId },
          { assigneeId: userId },
          { project: { members: { some: { userId } } } },
        ],
        createdAt: { gte: dateFrom, lte: now },
      },
      _count: {
        id: true,
      },
    });

    // Format data for charts
    const taskData = taskTrends.map((item) => ({
      status: item.status,
      priority: item.priority,
      count: item._count.id,
    }));

    res.json({
      success: true,
      data: {
        period,
        tasks: taskData,
      },
    });
  } catch (error) {
    logger.error('Failed to get task analytics:', error);
    throw error;
  }
});

export default router;