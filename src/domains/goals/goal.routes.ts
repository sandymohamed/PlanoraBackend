import { Router, Response } from 'express';
import Joi from 'joi';
import { getPrismaClient, executeWithRetry } from '../../shared/utils/database';
import { authenticateToken } from '../../shared/middleware/auth';
import { AuthenticatedRequest, ValidationError, NotFoundError } from '../../shared/types';
import { logger } from '../../shared/utils/logger';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

const createGoalSchema = Joi.object({
  title: Joi.string().min(1).max(255).required(),
  description: Joi.string().max(1000).optional(),
  status: Joi.string().valid('DRAFT', 'ACTIVE', 'PAUSED', 'DONE', 'CANCELLED').optional(),
  priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'URGENT').optional(),
  category: Joi.string().max(100).optional(),
  targetDate: Joi.date().optional(),
  progress: Joi.number().min(0).max(100).optional(),
  metadata: Joi.object().optional(),
});

const updateGoalSchema = Joi.object({
  title: Joi.string().min(1).max(255).optional(),
  description: Joi.string().max(1000).optional(),
  status: Joi.string().valid('DRAFT', 'ACTIVE', 'PAUSED', 'DONE', 'CANCELLED').optional(),
  priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'URGENT').optional(),
  category: Joi.string().max(100).optional(),
  targetDate: Joi.date().optional(),
  progress: Joi.number().min(0).max(100).optional(),
  completedAt: Joi.date().optional(),
  metadata: Joi.object().optional(),
});

// GET /api/v1/goals
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const where: any = {
      userId,
    };

    if (search) {
      where.OR = [
        { title: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    if (status) {
      const statuses = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      where.status = statuses.length > 1 ? { in: statuses } : statuses[0];
    }

    const [goals, total] = await executeWithRetry(async () => {
      return await Promise.all([
        prisma.goal.findMany({
          where,
          include: {
            milestones: {
              orderBy: { createdAt: 'asc' },
            },
            _count: {
              select: { milestones: true, tasks: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
        }),
        prisma.goal.count({ where }),
      ]);
    });

    // Calculate progress for each goal and check for overdue milestones
    const goalsWithProgress = await Promise.all(goals.map(async (goal: any) => {
      const totalMilestones = goal.milestones.length;
      // Check for DONE status (case-insensitive to handle any variations)
      const completedMilestones = goal.milestones.filter((m: any) => 
        m.status && (m.status.toUpperCase() === 'DONE' || m.status === 'DONE')
      ).length;
      const calculatedProgress = totalMilestones > 0 
        ? Math.round((completedMilestones / totalMilestones) * 100) 
        : (goal.progress || 0);

      // Update goal progress in database if it's different
      if (calculatedProgress !== (goal.progress || 0)) {
        await executeWithRetry(async () => {
          return await prisma.goal.update({
            where: { id: goal.id },
            data: { progress: calculatedProgress },
          });
        });
      }

      return {
        ...goal,
        progress: calculatedProgress, // Always use calculated progress
        milestones: goal.milestones.map((milestone: any) => ({
          ...milestone,
          targetDate: milestone.dueDate ? milestone.dueDate.toISOString() : null,
        })),
      };
    }));

    // Check for overdue milestones (only once, not per goal)
    const { checkAndNotifyOverdueMilestones } = await import('../../infrastructure/queue/notificationScheduler');
    checkAndNotifyOverdueMilestones().catch(err => 
      logger.error('Failed to check overdue milestones:', err)
    );

    res.json({
      success: true,
      data: goalsWithProgress,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    logger.error('Failed to get goals:', error);
    throw error;
  }
});

// GET /api/v1/goals/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const goal = await executeWithRetry(async () => {
      return await prisma.goal.findFirst({
        where: {
          id,
          userId,
        },
        include: {
          milestones: {
            orderBy: { createdAt: 'asc' },
          },
          tasks: {
            include: {
              creator: {
                select: { id: true, name: true, email: true },
              },
              assignee: {
                select: { id: true, name: true, email: true },
              },
            },
            orderBy: { createdAt: 'desc' },
          },
          _count: {
            select: { milestones: true, tasks: true },
          },
        },
      });
    });

    if (!goal) {
      throw new NotFoundError('Goal');
    }

    // Calculate progress based on completed milestones
    const totalMilestones = goal.milestones.length;
    // Check for DONE status (case-insensitive to handle any variations)
    const completedMilestones = goal.milestones.filter((m: any) => 
      m.status && (m.status.toUpperCase() === 'DONE' || m.status === 'DONE')
    ).length;
    const calculatedProgress = totalMilestones > 0 
      ? Math.round((completedMilestones / totalMilestones) * 100) 
      : (goal.progress || 0);
    
    logger.info(`Goal ${goal.id} progress calculation: ${completedMilestones}/${totalMilestones} = ${calculatedProgress}%`);

    // Update goal progress in database if it's different
    if (calculatedProgress !== (goal.progress || 0)) {
      await executeWithRetry(async () => {
        return await prisma.goal.update({
          where: { id: goal.id },
          data: { progress: calculatedProgress },
        });
      });
      // Update the goal object with new progress
      goal.progress = calculatedProgress;
    }

    // Check for overdue milestones and send notifications
    const { checkAndNotifyOverdueMilestones } = await import('../../infrastructure/queue/notificationScheduler');
    checkAndNotifyOverdueMilestones().catch(err => 
      logger.error('Failed to check overdue milestones:', err)
    );

    // Map milestone dueDate to targetDate for frontend compatibility
    const goalWithMappedMilestones = {
      ...goal,
      progress: calculatedProgress,
      milestones: goal.milestones.map((milestone: any) => ({
        ...milestone,
        targetDate: milestone.dueDate ? milestone.dueDate.toISOString() : null,
      })),
    };

    res.json({
      success: true,
      data: goalWithMappedMilestones,
    });
  } catch (error) {
    logger.error('Failed to get goal:', error);
    throw error;
  }
});

// POST /api/v1/goals
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error, value } = createGoalSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Set status to ACTIVE by default if not provided
    const goalData = {
      ...value,
      status: value.status || 'ACTIVE',
      userId,
    };

    const goal = await executeWithRetry(async () => {
      return await prisma.goal.create({
        data: goalData,
        include: {
          milestones: true,
          _count: {
            select: { milestones: true, tasks: true },
          },
        },
      });
    });

    // Schedule notifications for target date if provided
    if (goal.targetDate) {
      const { scheduleGoalTargetDateNotifications } = await import('../../infrastructure/queue/notificationScheduler');
      scheduleGoalTargetDateNotifications(goal.id, userId, goal.targetDate, goal.title)
        .catch(err => logger.error('Failed to schedule goal notifications:', err));
    }

    logger.info('Goal created successfully', { goalId: goal.id, userId });

    res.status(201).json({
      success: true,
      data: goal,
      message: 'Goal created successfully',
    });
  } catch (error) {
    logger.error('Failed to create goal:', error);
    throw error;
  }
});

// PUT /api/v1/goals/:id
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { error, value } = updateGoalSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const goal = await executeWithRetry(async () => {
      return await prisma.goal.findFirst({
        where: { id, userId },
      });
    });

    if (!goal) {
      throw new NotFoundError('Goal');
    }

    const updatedGoal = await executeWithRetry(async () => {
      return await prisma.goal.update({
        where: { id },
        data: value,
        include: {
          milestones: {
            orderBy: { createdAt: 'asc' },
          },
          _count: {
            select: { milestones: true, tasks: true },
          },
        },
      });
    });

    // Reschedule notifications if target date changed
    if (value.targetDate !== undefined && updatedGoal.targetDate) {
      const { scheduleGoalTargetDateNotifications } = await import('../../infrastructure/queue/notificationScheduler');
      scheduleGoalTargetDateNotifications(updatedGoal.id, userId, updatedGoal.targetDate, updatedGoal.title)
        .catch(err => logger.error('Failed to reschedule goal notifications:', err));
    }

    logger.info('Goal updated successfully', { goalId: id, userId });

    res.json({
      success: true,
      data: updatedGoal,
      message: 'Goal updated successfully',
    });
  } catch (error) {
    logger.error('Failed to update goal:', error);
    throw error;
  }
});

// DELETE /api/v1/goals/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const goal = await executeWithRetry(async () => {
      return await prisma.goal.findFirst({
        where: { id, userId },
      });
    });

    if (!goal) {
      throw new NotFoundError('Goal');
    }

    await executeWithRetry(async () => {
      return await prisma.goal.delete({
        where: { id },
      });
    });

    logger.info('Goal deleted successfully', { goalId: id, userId });

    res.json({
      success: true,
      message: 'Goal deleted successfully',
    });
  } catch (error) {
    logger.error('Failed to delete goal:', error);
    throw error;
  }
});
// POST /api/v1/goals/:id/milestones/:milestoneId/complete  
router.post('/:id/milestones/:milestoneId/complete', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, milestoneId } = req.params;
    // No body parameters needed for completion
    const userId = req.user!.id;
    const prisma = getPrismaClient();
    const goal = await executeWithRetry(async () => {
      return await prisma.goal.findFirst({
        where: { id, userId },
      });
    });

    if (!goal) {
      throw new NotFoundError('Goal');
    }

    const milestone = await executeWithRetry(async () => {
      return await prisma.milestone.update({
        where: { id: milestoneId },
        data: {
          status: 'DONE',
          completedAt: new Date(),
        },
      });
    });

    // Recalculate goal progress based on completed milestones
    const goalWithMilestones = await executeWithRetry(async () => {
      return await prisma.goal.findFirst({
        where: { id, userId },
        include: {
          milestones: true,
        },
      });
    });

    if (goalWithMilestones) {
      const totalMilestones = goalWithMilestones.milestones.length;
      const completedMilestones = goalWithMilestones.milestones.filter(m => m.status === 'DONE').length;
      const newProgress = totalMilestones > 0 
        ? Math.round((completedMilestones / totalMilestones) * 100) 
        : goalWithMilestones.progress;

      // Update goal progress
      await executeWithRetry(async () => {
        return await prisma.goal.update({
          where: { id: goalWithMilestones.id },
          data: { progress: newProgress },
        });
      });
    }

    // Map dueDate to targetDate for frontend compatibility
    const milestoneResponse = {
      ...milestone,
      targetDate: milestone.dueDate ? milestone.dueDate.toISOString() : null,
    };

    res.json({
      success: true,
      data: milestoneResponse,
      message: 'Milestone Completed successfully',
    });
  } catch (error) {
    logger.error('Failed to update milestone:', error);
    throw error;
  }
});

// POST /api/v1/goals/:id/milestones
router.post('/:id/milestones', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { title, dueDate, weight } = req.body;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const goal = await executeWithRetry(async () => {
      return await prisma.goal.findFirst({
        where: { id, userId },
      });
    });

    if (!goal) {
      throw new NotFoundError('Goal');
    }

    const milestone = await executeWithRetry(async () => {
      return await prisma.milestone.create({
        data: {
          goalId: id,
          title,
          // description,
          dueDate: dueDate ? new Date(dueDate) : null,
          weight: weight || 0,
          status: 'TODO',
        },
      });
    });

    console.log("** my milestone:",milestone)

    // Schedule notifications for milestone due date if provided
    if (milestone.dueDate) {
      const { scheduleMilestoneDueDateNotifications } = await import('../../infrastructure/queue/notificationScheduler');
      scheduleMilestoneDueDateNotifications(milestone.id, id, userId, milestone.dueDate, milestone.title)
        .catch(err => logger.error('Failed to schedule milestone notifications:', err));
    }

    // Map dueDate to targetDate for frontend compatibility
    const milestoneResponse = {
      ...milestone,
      targetDate: milestone.dueDate ? milestone.dueDate.toISOString() : null,
    };

    res.status(201).json({
      success: true,
      data: milestoneResponse,
      message: 'Milestone created successfully',
    });
  } catch (error) {
    logger.error('Failed to create milestone:', error);
    throw error;
  }
});


// PUT /api/v1/goals/:id/milestones/:milestoneId
router.put('/:id/milestones/:milestoneId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, milestoneId } = req.params;
    const { title, description, dueDate, weight, status, completedAt } = req.body;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const goal = await executeWithRetry(async () => {
      return await prisma.goal.findFirst({
        where: { id, userId },
      });
    });

    if (!goal) {
      throw new NotFoundError('Goal');
    }

    const milestone = await executeWithRetry(async () => {
      return await prisma.milestone.update({
        where: { id: milestoneId },
        data: {
          title,
          description,
          dueDate: dueDate ? new Date(dueDate) : null,
          weight,
          status,
          completedAt: completedAt ? new Date(completedAt) : null,
        },
      });
    });

    // Reschedule notifications if due date changed
    if (dueDate !== undefined && milestone.dueDate) {
      const { scheduleMilestoneDueDateNotifications } = await import('../../infrastructure/queue/notificationScheduler');
      scheduleMilestoneDueDateNotifications(milestone.id, id, userId, milestone.dueDate, milestone.title)
        .catch(err => logger.error('Failed to reschedule milestone notifications:', err));
    }

    logger.info('Milestone updated successfully', { goalId: id, milestoneId, userId });

    // Map dueDate to targetDate for frontend compatibility
    const milestoneResponse = {
      ...milestone,
      targetDate: milestone.dueDate ? milestone.dueDate.toISOString() : null,
    };

    res.json({
      success: true,
      data: milestoneResponse,
      message: 'Milestone updated successfully',
    });
  } catch (error) {
    logger.error('Failed to update milestone:', error);
    throw error;
  }
});

// DELETE /api/v1/goals/:id/milestones/:milestoneId
router.delete('/:id/milestones/:milestoneId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, milestoneId } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const goal = await executeWithRetry(async () => {
      return await prisma.goal.findFirst({
        where: { id, userId },
      });
    });

    if (!goal) {
      throw new NotFoundError('Goal');
    }

    await executeWithRetry(async () => {
      return await prisma.milestone.delete({
        where: { id: milestoneId },
      });
    });

    logger.info('Milestone deleted successfully', { goalId: id, milestoneId, userId });

    res.json({
      success: true,
      message: 'Milestone deleted successfully',
    });
  } catch (error) {
    logger.error('Failed to delete milestone:', error);
    throw error;
  }
});

export default router;
