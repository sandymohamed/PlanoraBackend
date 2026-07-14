import { Router, Response } from 'express';
import Joi from 'joi';
import { authenticateToken } from '../../shared/middleware/auth';
import { AuthenticatedRequest } from '../../shared/types';
import { logger } from '../../shared/utils/logger';
import { routineService, CreateRoutineData, CreateRoutineTaskData } from './routine.service';
import { scheduleRoutineNotifications, cancelRoutineNotifications, cancelRoutineTaskNotifications, scheduleRoutineTaskNotifications } from '../../infrastructure/queue/notificationScheduler';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Validation schemas
const createRoutineSchema = Joi.object({
  title: Joi.string().trim().min(1).required(),
  description: Joi.string().trim().allow('', null).optional(),
  frequency: Joi.string().valid('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY').required(),
  schedule: Joi.object({
    time: Joi.string().pattern(/^\d{2}:\d{2}$/).optional(),
    days: Joi.array().items(Joi.number().min(0).max(6)).optional(),
    day: Joi.number().min(1).max(31).optional(),
  }).required(),
  timezone: Joi.string().optional().default('UTC'),
  reminderBefore: Joi.string().pattern(/^\d+[mhdw]$/).optional().allow(null, ''),
});

const updateRoutineSchema = Joi.object({
  title: Joi.string().trim().min(1).optional(),
  description: Joi.string().trim().allow('', null).optional(),
  frequency: Joi.string().valid('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY').optional(),
  schedule: Joi.object({
    time: Joi.string().pattern(/^\d{2}:\d{2}$/).optional(),
    days: Joi.array().items(Joi.number().min(0).max(6)).optional(),
    day: Joi.number().min(1).max(31).optional(),
  }).optional(),
  timezone: Joi.string().optional(),
  enabled: Joi.boolean().optional(),
  reminderBefore: Joi.string().pattern(/^\d+[mhdw]$/).optional().allow(null, ''),
});

const createTaskSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().optional(),
  order: Joi.number().optional(),
  reminderTime: Joi.string().optional(),
});

// GET /api/v1/routines
router.get('/', async (req: AuthenticatedRequest, res: Response) => {

  try {
    const userId = req.user!.id;
    const routines = await routineService.getUserRoutines(userId);
    
    return res.json({
      success: true,
      data: routines,
    });
  } catch (error) {
    console.log('Failed to get routines:', error);
    logger.error('Failed to get routines:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get routines',
    });
  }
});

// POST /api/v1/routines
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  console.log('Creating routine with request body:', req.body);
  try {
    
    const userId = req.user!.id;
    const { error, value } = createRoutineSchema.validate(req.body);
    
    console.log('Creating routine with request value:', value);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }
    
    // Convert empty description to undefined/null
    if (value.description === '' || value.description === null) {
      value.description = undefined;
    }
    
    // Convert empty reminderBefore to undefined/null
    if (value.reminderBefore === '' || value.reminderBefore === null) {
      value.reminderBefore = undefined;
    }
    
    const routine = await routineService.createRoutine(userId, value as CreateRoutineData);
    
    console.log(`Routine created: ${routine.id} for user ${userId}`, routine);
    // Automatically create one task for the routine using routine title and description
    try {
      await routineService.addTaskToRoutine(routine.id, userId, {
        title: value.title,
        description: value.description,
        order: 0,
      });
      
      // Reload routine with the newly created task
      // Use retry logic to handle connection errors
      let routineWithTask;
      try {
        routineWithTask = await routineService.getRoutineById(routine.id, userId);
      } catch (getError: any) {
        // If getting routine fails due to connection error, wait a bit and try again
        if (getError?.code === 'P1017' || getError?.message?.includes('connection')) {
          logger.warn('Connection error when getting routine, retrying...', { routineId: routine.id });
          await new Promise(resolve => setTimeout(resolve, 500));
          routineWithTask = await routineService.getRoutineById(routine.id, userId);
        } else {
          throw getError;
        }
      }
      
      
      // Schedule notifications for the routine
      if (routineWithTask && routineWithTask.enabled) {
        scheduleRoutineNotifications(routine.id, userId)
          .catch(err => logger.error('Failed to schedule routine notifications:', err));
      }
      
      return res.status(201).json({
        success: true,
        data: routineWithTask || routine,
      });
    } catch (taskError: any) {
      logger.error('Failed to create automatic task for routine:', taskError);
      // If task creation fails, still return the routine but log the error
      // Schedule notifications anyway
      if (routine.enabled) {
        scheduleRoutineNotifications(routine.id, userId)
          .catch(err => logger.error('Failed to schedule routine notifications:', err));
      }
      
      return res.status(201).json({
        success: true,
        data: routine,
        warning: 'Routine created but automatic task creation failed',
      });
    }
  } catch (error) {
    logger.error('Failed to create routine:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create routine',
    });
  }
});

// GET /api/v1/routines/:routineId
router.get('/:routineId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { routineId } = req.params;
    
    const routine = await routineService.getRoutineById(routineId, userId);
    
    if (!routine) {
      return res.status(404).json({
        success: false,
        message: 'Routine not found',
      });
    }
    
    return res.json({
      success: true,
      data: routine,
    });
  } catch (error) {
    logger.error('Failed to get routine:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get routine',
    });
  }
});

// PUT /api/v1/routines/:routineId
router.put('/:routineId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { routineId } = req.params;
    const { error, value } = updateRoutineSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }
    
    // Convert empty description to undefined/null
    if (value.description === '' || value.description === null) {
      value.description = undefined;
    }
    
    // Convert empty reminderBefore to undefined/null
    if (value.reminderBefore === '' || value.reminderBefore === null) {
      value.reminderBefore = undefined;
    }
    
    const routine = await routineService.updateRoutine(routineId, userId, value);
    
    // If title or description changed, update the first (and only) routine task
    if (value.title !== undefined || value.description !== undefined) {
      try {
        // Get the routine tasks - there should be only one
        const routineTasks = routine.routineTasks || [];
        if (routineTasks.length > 0) {
          // Update the first task (order 0) with new title/description
          const taskToUpdate = routineTasks[0];
          const updateTaskData: any = {};
          if (value.title !== undefined) {
            updateTaskData.title = value.title;
          }
          if (value.description !== undefined) {
            updateTaskData.description = value.description || null;
          }
          
          await routineService.updateRoutineTask(taskToUpdate.id, userId, updateTaskData);
          
          // Reload routine with updated task
          const updatedRoutine = await routineService.getRoutineById(routineId, userId);
          
          // Reschedule notifications if routine is enabled, otherwise cancel them
          if (updatedRoutine && updatedRoutine.enabled) {
            // Cancel existing notifications first
            await cancelRoutineNotifications(routineId, userId);
            // Schedule new notifications
            scheduleRoutineNotifications(routineId, userId)
              .catch(err => logger.error('Failed to schedule routine notifications:', err));
          } else {
            // Cancel notifications if routine is disabled
            cancelRoutineNotifications(routineId, userId)
              .catch(err => logger.error('Failed to cancel routine notifications:', err));
          }
          
          return res.json({
            success: true,
            data: updatedRoutine || routine,
          });
        }
      } catch (taskError: any) {
        logger.error('Failed to update routine task:', taskError);
        // Continue even if task update fails
      }
    }
    
    // Reschedule notifications if routine is enabled, otherwise cancel them
    if (routine.enabled) {
      // Cancel existing notifications first
      await cancelRoutineNotifications(routineId, userId);
      // Schedule new notifications
      scheduleRoutineNotifications(routineId, userId)
        .catch(err => logger.error('Failed to schedule routine notifications:', err));
    } else {
      // Cancel notifications if routine is disabled
      cancelRoutineNotifications(routineId, userId)
        .catch(err => logger.error('Failed to cancel routine notifications:', err));
    }
    
    return res.json({
      success: true,
      data: routine,
    });
  } catch (error: any) {
    logger.error('Failed to update routine:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update routine',
    });
  }
});

// DELETE /api/v1/routines/:routineId
router.delete('/:routineId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { routineId } = req.params;

    // Cancel notifications before deleting; cancellation needs routine/task data.
    await cancelRoutineNotifications(routineId, userId);
    await routineService.deleteRoutine(routineId, userId);
    
    return res.json({
      success: true,
      message: 'Routine deleted successfully',
    });
  } catch (error: any) {
    logger.error('Failed to delete routine:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete routine',
    });
  }
});

// POST /api/v1/routines/:routineId/tasks
router.post('/:routineId/tasks', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { routineId } = req.params;
    const { error, value } = createTaskSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }
    
    const task = await routineService.addTaskToRoutine(routineId, userId, value as CreateRoutineTaskData);
    
    // Get routine details to schedule notification
    const routine = await routineService.getRoutineById(routineId, userId);
    if (routine && routine.enabled) {
      const schedule = routine.schedule as any;
      scheduleRoutineTaskNotifications(
        routineId,
        userId,
        routine.title,
        routine.frequency,
        schedule,
        routine.timezone,
        task.id,
        task.title,
        task.reminderTime
      ).catch(err => logger.error('Failed to schedule routine task notification:', err));
    }
    
    return res.status(201).json({
      success: true,
      data: task,
    });
  } catch (error: any) {
    logger.error('Failed to add task to routine:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to add task',
    });
  }
});

// PUT /api/v1/routines/tasks/:taskId
router.put('/tasks/:taskId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { taskId } = req.params;
    
    // Get task first to get routineId
    const { getPrismaClient } = await import('../../shared/utils/database');
    const prisma = getPrismaClient();
    const existingTask = await prisma.routineTask.findUnique({
      where: { id: taskId },
      include: { routine: true },
    });
    
    if (!existingTask || existingTask.routine.userId !== userId) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      });
    }
    
    const task = await routineService.updateRoutineTask(taskId, userId, req.body);
    
    // Get routine details to reschedule notification
    const routine = existingTask.routine;
    if (routine.enabled) {
      // Cancel existing notification
      await cancelRoutineTaskNotifications(taskId, userId);
      // Schedule new notification
      const schedule = routine.schedule as any;
      scheduleRoutineTaskNotifications(
        routine.id,
        userId,
        routine.title,
        routine.frequency,
        schedule,
        routine.timezone,
        task.id,
        task.title,
        task.reminderTime
      ).catch(err => logger.error('Failed to schedule routine task notification:', err));
    } else {
      // Cancel notification if routine is disabled
      cancelRoutineTaskNotifications(taskId, userId)
        .catch(err => logger.error('Failed to cancel routine task notification:', err));
    }
    
    return res.json({
      success: true,
      data: task,
    });
  } catch (error: any) {
    logger.error('Failed to update task:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update task',
    });
  }
});

// DELETE /api/v1/routines/tasks/:taskId
router.delete('/tasks/:taskId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { taskId } = req.params;
    
    await routineService.deleteRoutineTask(taskId, userId);
    
    // Cancel notifications for this task
    cancelRoutineTaskNotifications(taskId, userId)
      .catch(err => logger.error('Failed to cancel routine task notification:', err));
    
    return res.json({
      success: true,
      message: 'Task deleted successfully',
    });
  } catch (error: any) {
    logger.error('Failed to delete task:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete task',
    });
  }
});

// PUT /api/v1/routines/tasks/:taskId/toggle
router.put('/tasks/:taskId/toggle', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { taskId } = req.params;
    const { completed } = req.body;
    
    const task = await routineService.toggleTaskCompletion(taskId, userId, completed);
    
    return res.json({
      success: true,
      data: task,
    });
  } catch (error: any) {
    logger.error('Failed to toggle task:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to toggle task',
    });
  }
});

// POST /api/v1/routines/:routineId/reset
router.post('/:routineId/reset', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { routineId } = req.params;
    
    // Get routine first to check if it exists and is enabled
    const routine = await routineService.getRoutineById(routineId, userId);
    if (!routine) {
      return res.status(404).json({
        success: false,
        message: 'Routine not found',
      });
    }
    
    await routineService.resetRoutineTasks(routineId);
    
    // Reschedule notifications for the next occurrence after reset if routine is enabled
    if (routine.enabled) {
      scheduleRoutineNotifications(routineId, userId)
        .catch(err => logger.error('Failed to reschedule routine notifications after reset:', err));
    }
    
    return res.json({
      success: true,
      message: 'Routine reset successfully',
    });
  } catch (error: any) {
    logger.error('Failed to reset routine:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to reset routine',
    });
  }
});

export default router;


