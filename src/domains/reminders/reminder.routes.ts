import { Router, Response } from 'express';
import Joi from 'joi';
import { getPrismaClient } from '../../shared/utils/database';
import { authenticateToken } from '../../shared/middleware/auth';
import { AuthenticatedRequest, ValidationError, NotFoundError } from '../../shared/types';
import { logger } from '../../shared/utils/logger';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

const createReminderSchema = Joi.object({
  targetType: Joi.string().valid('TASK', 'GOAL', 'PROJECT', 'CUSTOM').required(),
  targetId: Joi.string().uuid().optional(),
  title: Joi.string().min(1).max(255).required(),
  note: Joi.string().max(500).optional(),
  triggerType: Joi.string().valid('TIME', 'LOCATION', 'BOTH').required(),
  schedule: Joi.object({
    nextOccurrence: Joi.date().optional(),
    timeOfDay: Joi.string().optional(),
    rrule: Joi.string().optional(),
    timezone: Joi.string().optional(),
  }).required(),
  geo: Joi.object({
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
    radius: Joi.number().min(1).max(10000).required(),
    onEnter: Joi.boolean().optional(),
    onExit: Joi.boolean().optional(),
  }).optional(),
});

const updateReminderSchema = Joi.object({
  title: Joi.string().min(1).max(255).optional(),
  note: Joi.string().max(500).optional(),
  triggerType: Joi.string().valid('TIME', 'LOCATION', 'BOTH').optional(),
  schedule: Joi.object({
    nextOccurrence: Joi.date().optional(),
    timeOfDay: Joi.string().optional(),
    rrule: Joi.string().optional(),
    timezone: Joi.string().optional(),
  }).optional(),
  geo: Joi.object({
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
    radius: Joi.number().min(1).max(10000).required(),
    onEnter: Joi.boolean().optional(),
    onExit: Joi.boolean().optional(),
  }).optional(),
});

// GET /api/v1/reminders
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, limit = 20, targetType, triggerType } = req.query;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const where: any = {
      userId,
    };

    if (targetType) {
      where.targetType = targetType;
    }

    if (triggerType) {
      where.triggerType = triggerType;
    }

    const reminders = await prisma.reminder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });

    // Filter out reminders for disabled routines
    const filteredReminders = await Promise.all(
      reminders.map(async (reminder) => {
        // Check if this is a routine reminder
        const schedule = reminder.schedule as any;
        if (schedule?.routineId && reminder.targetType === 'CUSTOM') {
          const routine = await prisma.routine.findUnique({
            where: { id: schedule.routineId },
            select: { enabled: true, userId: true },
          });

          // Filter out if routine doesn't exist, is disabled, or doesn't belong to user
          if (!routine || !routine.enabled || routine.userId !== userId) {
            return null;
          }
        }
        return reminder;
      })
    );

    // Remove null entries
    const validReminders = filteredReminders.filter((r): r is typeof reminders[0] => r !== null);

    res.json({
      success: true,
      data: validReminders,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: validReminders.length, // Note: this is filtered count, not total in DB
        totalPages: Math.ceil(validReminders.length / Number(limit)),
      },
    });
  } catch (error) {
    logger.error('Failed to get reminders:', error);
    throw error;
  }
});

// GET /api/v1/reminders/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const reminder = await prisma.reminder.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!reminder) {
      throw new NotFoundError('Reminder');
    }

    res.json({
      success: true,
      data: reminder,
    });
  } catch (error) {
    logger.error('Failed to get reminder:', error);
    throw error;
  }
});

// POST /api/v1/reminders
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error, value } = createReminderSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const reminder = await prisma.reminder.create({
      data: {
        ...value,
        userId,
        schedule: value.schedule,
        geo: value.geo,
      },
    });

    logger.info('Reminder created successfully', { reminderId: reminder.id, userId });

    res.status(201).json({
      success: true,
      data: reminder,
      message: 'Reminder created successfully',
    });
  } catch (error) {
    logger.error('Failed to create reminder:', error);
    throw error;
  }
});

// PUT /api/v1/reminders/:id
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { error, value } = updateReminderSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const reminder = await prisma.reminder.findFirst({
      where: { id, userId },
    });

    if (!reminder) {
      throw new NotFoundError('Reminder');
    }

    const updatedReminder = await prisma.reminder.update({
      where: { id },
      data: {
        ...value,
        schedule: value.schedule,
        geo: value.geo,
      },
    });

    logger.info('Reminder updated successfully', { reminderId: id, userId });

    res.json({
      success: true,
      data: updatedReminder,
      message: 'Reminder updated successfully',
    });
  } catch (error) {
    logger.error('Failed to update reminder:', error);
    throw error;
  }
});

// DELETE /api/v1/reminders/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const reminder = await prisma.reminder.findFirst({
      where: { id, userId },
    });

    if (!reminder) {
      throw new NotFoundError('Reminder');
    }

    await prisma.reminder.delete({
      where: { id },
    });

    logger.info('Reminder deleted successfully', { reminderId: id, userId });

    res.json({
      success: true,
      message: 'Reminder deleted successfully',
    });
  } catch (error) {
    logger.error('Failed to delete reminder:', error);
    throw error;
  }
});

// POST /api/v1/reminders/:id/trigger
router.post('/:id/trigger', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { triggerType } = req.body;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const reminder = await prisma.reminder.findFirst({
      where: { id, userId },
    });

    if (!reminder) {
      throw new NotFoundError('Reminder');
    }

    // TODO: Process reminder trigger
    // This would typically send notifications, update status, etc.
    logger.info('Reminder triggered', { reminderId: id, triggerType, userId });

    res.json({
      success: true,
      message: 'Reminder triggered successfully',
    });
  } catch (error) {
    logger.error('Failed to trigger reminder:', error);
    throw error;
  }
});

export default router;
