import { Router, Response } from 'express';
import Joi from 'joi';
import { getPrismaClient } from '../../shared/utils/database';
import { authenticateToken } from '../../shared/middleware/auth';
import { AuthenticatedRequest, ValidationError, NotFoundError } from '../../shared/types';
import { logger } from '../../shared/utils/logger';
import { scheduleAlarmPushNotification, cancelAlarmPushNotifications, cancelAllPendingAlarmNotifications } from '../../infrastructure/queue/notificationScheduler';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

const createAlarmSchema = Joi.object({
  title: Joi.string().min(1).max(255).required(),
  time: Joi.date().required(),
  timezone: Joi.string().optional(),
  recurrenceRule: Joi.string().optional(),
  toneUrl: Joi.string().optional(),
  smartWakeWindow: Joi.number().min(5).max(60).optional(),
  linkedTaskId: Joi.string().uuid().optional(),
  enabled: Joi.boolean().optional(),
  snoozeConfig: Joi.object({
    duration: Joi.number().min(1).max(60).required(),
    maxSnoozes: Joi.number().min(0).max(10).required(),
    snoozeCount: Joi.number().min(0).optional(),
  }).optional(),
});

const updateAlarmSchema = Joi.object({
  title: Joi.string().min(1).max(255).optional(),
  time: Joi.date().optional(),
  timezone: Joi.string().optional(),
  recurrenceRule: Joi.string().optional(),
  toneUrl: Joi.string().optional(),
  smartWakeWindow: Joi.number().min(5).max(60).optional(),
  linkedTaskId: Joi.string().uuid().optional(),
  enabled: Joi.boolean().optional(),
  snoozeConfig: Joi.object({
    duration: Joi.number().min(1).max(60).required(),
    maxSnoozes: Joi.number().min(0).max(10).required(),
    snoozeCount: Joi.number().min(0).optional(),
  }).optional(),
});

// GET /api/v1/alarms
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, limit = 20, enabled } = req.query;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const where: any = {
      userId,
    };

    if (enabled !== undefined) {
      where.enabled = enabled === 'true';
    }

    const [alarms, total] = await Promise.all([
      prisma.alarm.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.alarm.count({ where }),
    ]);

    res.json({
      success: true,
      data: alarms,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    logger.error('Failed to get alarms:', error);
    throw error;
  }
});

// GET /api/v1/alarms/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const alarm = await prisma.alarm.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!alarm) {
      throw new NotFoundError('Alarm');
    }

    res.json({
      success: true,
      data: alarm,
    });
  } catch (error) {
    logger.error('Failed to get alarm:', error);
    throw error;
  }
});

// POST /api/v1/alarms
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error, value } = createAlarmSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const alarm = await prisma.alarm.create({
      data: {
        ...value,
        userId,
        snoozeConfig: value.snoozeConfig,
      },
    });

    logger.info('Alarm created successfully', { alarmId: alarm.id, userId });

    // NOTE: Backend push notifications are DISABLED for alarms
    // Native Android AlarmManager handles all alarm ringing via AlarmPlayerService
    // This prevents double-ringing (backend push notification + native alarm)
    // The frontend schedules native alarms via ReliableAlarmService when alarms are loaded
    // Backend push notifications are only used for task/routine reminders, not alarms
    
    // Cancel any existing backend push notifications for this alarm (cleanup)
    try {
      await cancelAlarmPushNotifications(alarm.id, alarm.userId);
      logger.debug('Cleaned up any existing backend push notifications for alarm', { alarmId: alarm.id });
    } catch (cancelError) {
      logger.warn('Failed to cancel existing alarm push notifications', { alarmId: alarm.id, error: cancelError });
    }

    res.status(201).json({
      success: true,
      data: alarm,
      message: 'Alarm created successfully',
    });
  } catch (error) {
    logger.error('Failed to create alarm:', error);
    throw error;
  }
});

// PUT /api/v1/alarms/:id
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { error, value } = updateAlarmSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const alarm = await prisma.alarm.findFirst({
      where: { id, userId },
    });

    if (!alarm) {
      throw new NotFoundError('Alarm');
    }

    const updatedAlarm = await prisma.alarm.update({
      where: { id },
      data: {
        ...value,
        snoozeConfig: value.snoozeConfig,
      },
    });

    logger.info('Alarm updated successfully', { alarmId: id, userId });

    // NOTE: Backend push notifications are DISABLED for alarms
    // Native Android AlarmManager handles all alarm ringing via AlarmPlayerService
    // This prevents double-ringing (backend push notification + native alarm)
    // The frontend schedules native alarms via ReliableAlarmService when alarms are loaded/updated
    // Backend push notifications are only used for task/routine reminders, not alarms
    
    // Cancel any existing backend push notifications for this alarm (cleanup)
    try {
      await cancelAlarmPushNotifications(updatedAlarm.id, updatedAlarm.userId);
      logger.debug('Cleaned up any existing backend push notifications for alarm', { alarmId: updatedAlarm.id });
    } catch (cancelError) {
      logger.warn('Failed to cancel existing alarm push notifications', { alarmId: updatedAlarm.id, error: cancelError });
    }

    res.json({
      success: true,
      data: updatedAlarm,
      message: 'Alarm updated successfully',
    });
  } catch (error) {
    logger.error('Failed to update alarm:', error);
    throw error;
  }
});

// DELETE /api/v1/alarms/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Check if alarm exists and belongs to user
    const alarm = await prisma.alarm.findFirst({
      where: { id, userId },
    });

    if (!alarm) {
      // Alarm doesn't exist or already deleted - return success (idempotent)
      logger.info('Alarm not found or already deleted', { alarmId: id, userId });
      return res.json({
        success: true,
        message: 'Alarm deleted successfully',
      });
    }

    // Delete the alarm
    await prisma.alarm.delete({
      where: { id },
    });

    // Cancel any scheduled notifications
    try {
      await cancelAlarmPushNotifications(id, userId);
    } catch (notifError) {
      logger.warn('Failed to cancel scheduled alarm notifications', { alarmId: id, error: notifError });
    }

    logger.info('Alarm deleted successfully', { alarmId: id, userId });

    return res.json({
      success: true,
      message: 'Alarm deleted successfully',
    });
  } catch (error: any) {
    // Handle Prisma error for record not found (P2025)
    if (error.code === 'P2025') {
      logger.info('Alarm already deleted', { alarmId: req.params.id, userId: req.user!.id });
      return res.json({
        success: true,
        message: 'Alarm deleted successfully',
      });
    }
    
    logger.error('Failed to delete alarm:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete alarm',
    });
  }
});

// POST /api/v1/alarms/:id/snooze
router.post('/:id/snooze', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { duration } = req.body;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const alarm = await prisma.alarm.findFirst({
      where: { id, userId },
    });

    if (!alarm) {
      // Alarm doesn't exist or already deleted - return success (idempotent)
      // This can happen if the routine was rescheduled and the alarm was recreated
      logger.info('Alarm not found or already deleted for snooze', { alarmId: id, userId });
      return res.json({
        success: true,
        message: 'Alarm snoozed successfully',
      });
    }

    // TODO: Implement snooze logic
    // For now, we just log it - the actual snooze should update the alarm time
    // by adding the duration (in minutes) to the current alarm time
    logger.info('Alarm snoozed', { alarmId: id, duration, userId });

   return res.json({
      success: true,
      message: 'Alarm snoozed successfully',
    });
  } catch (error: any) {
    // Handle Prisma error for record not found (P2025)
    if (error.code === 'P2025') {
      logger.info('Alarm already deleted during snooze', { alarmId: req.params.id, userId: req.user!.id });
      return res.json({
        success: true,
        message: 'Alarm snoozed successfully',
      });
    }
    
    logger.error('Failed to snooze alarm:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to snooze alarm',
    });
  }
});

// POST /api/v1/alarms/:id/dismiss
router.post('/:id/dismiss', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const alarm = await prisma.alarm.findFirst({
      where: { id, userId },
    });

    if (!alarm) {
      // Alarm doesn't exist or already deleted - return success (idempotent)
      logger.info('Alarm not found or already deleted for dismiss', { alarmId: id, userId });
      return res.json({
        success: true,
        message: 'Alarm dismissed successfully',
      });
    }

    // TODO: Implement dismiss logic (e.g., mark as dismissed, update last dismissed time)
    logger.info('Alarm dismissed', { alarmId: id, userId });

    return res.json({
      success: true,
      message: 'Alarm dismissed successfully',
    });
  } catch (error: any) {
    // Handle Prisma error for record not found (P2025)
    if (error.code === 'P2025') {
      logger.info('Alarm already deleted during dismiss', { alarmId: req.params.id, userId: req.user!.id });
      return res.json({
        success: true,
        message: 'Alarm dismissed successfully',
      });
    }
    
    logger.error('Failed to dismiss alarm:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to dismiss alarm',
    });
  }
});

// POST /api/v1/alarms/cancel-all-pending
// Cancel all pending alarm notifications for the current user
router.post('/cancel-all-pending', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    
    const cancelledCount = await cancelAllPendingAlarmNotifications(userId);
    
    logger.info(`Cancelled ${cancelledCount} pending alarm notifications for user ${userId}`);
    
    return res.json({
      success: true,
      message: `Cancelled ${cancelledCount} pending alarm notifications`,
      cancelledCount,
    });
  } catch (error: any) {
    logger.error('Failed to cancel all pending alarm notifications:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to cancel pending alarm notifications',
      message: error.message,
    });
  }
});

export default router;
