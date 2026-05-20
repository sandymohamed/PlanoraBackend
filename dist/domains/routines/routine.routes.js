"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const joi_1 = __importDefault(require("joi"));
const auth_1 = require("../../shared/middleware/auth");
const logger_1 = require("../../shared/utils/logger");
const routine_service_1 = require("./routine.service");
const notificationScheduler_1 = require("../../infrastructure/queue/notificationScheduler");
const router = (0, express_1.Router)();
// Apply authentication to all routes
router.use(auth_1.authenticateToken);
// Validation schemas
const createRoutineSchema = joi_1.default.object({
    title: joi_1.default.string().trim().min(1).required(),
    description: joi_1.default.string().trim().allow('', null).optional(),
    frequency: joi_1.default.string().valid('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY').required(),
    schedule: joi_1.default.object({
        time: joi_1.default.string().pattern(/^\d{2}:\d{2}$/).optional(),
        days: joi_1.default.array().items(joi_1.default.number().min(0).max(6)).optional(),
        day: joi_1.default.number().min(1).max(31).optional(),
    }).required(),
    timezone: joi_1.default.string().optional().default('UTC'),
    reminderBefore: joi_1.default.string().pattern(/^\d+[hdw]$/).optional().allow(null, ''),
});
const updateRoutineSchema = joi_1.default.object({
    title: joi_1.default.string().trim().min(1).optional(),
    description: joi_1.default.string().trim().allow('', null).optional(),
    frequency: joi_1.default.string().valid('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY').optional(),
    schedule: joi_1.default.object({
        time: joi_1.default.string().pattern(/^\d{2}:\d{2}$/).optional(),
        days: joi_1.default.array().items(joi_1.default.number().min(0).max(6)).optional(),
        day: joi_1.default.number().min(1).max(31).optional(),
    }).optional(),
    timezone: joi_1.default.string().optional(),
    enabled: joi_1.default.boolean().optional(),
    reminderBefore: joi_1.default.string().pattern(/^\d+[hdw]$/).optional().allow(null, ''),
});
const createTaskSchema = joi_1.default.object({
    title: joi_1.default.string().required(),
    description: joi_1.default.string().optional(),
    order: joi_1.default.number().optional(),
    reminderTime: joi_1.default.string().optional(),
});
// GET /api/v1/routines
router.get('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const routines = await routine_service_1.routineService.getUserRoutines(userId);
        return res.json({
            success: true,
            data: routines,
        });
    }
    catch (error) {
        console.log('Failed to get routines:', error);
        logger_1.logger.error('Failed to get routines:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to get routines',
        });
    }
});
// POST /api/v1/routines
router.post('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const { error, value } = createRoutineSchema.validate(req.body);
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
        const routine = await routine_service_1.routineService.createRoutine(userId, value);
        // Automatically create one task for the routine using routine title and description
        try {
            await routine_service_1.routineService.addTaskToRoutine(routine.id, userId, {
                title: value.title,
                description: value.description,
                order: 0,
            });
            // Reload routine with the newly created task
            // Use retry logic to handle connection errors
            let routineWithTask;
            try {
                routineWithTask = await routine_service_1.routineService.getRoutineById(routine.id, userId);
            }
            catch (getError) {
                // If getting routine fails due to connection error, wait a bit and try again
                if (getError?.code === 'P1017' || getError?.message?.includes('connection')) {
                    logger_1.logger.warn('Connection error when getting routine, retrying...', { routineId: routine.id });
                    await new Promise(resolve => setTimeout(resolve, 500));
                    routineWithTask = await routine_service_1.routineService.getRoutineById(routine.id, userId);
                }
                else {
                    throw getError;
                }
            }
            // Schedule notifications for the routine
            if (routineWithTask && routineWithTask.enabled) {
                (0, notificationScheduler_1.scheduleRoutineNotifications)(routine.id, userId)
                    .catch(err => logger_1.logger.error('Failed to schedule routine notifications:', err));
            }
            return res.status(201).json({
                success: true,
                data: routineWithTask || routine,
            });
        }
        catch (taskError) {
            logger_1.logger.error('Failed to create automatic task for routine:', taskError);
            // If task creation fails, still return the routine but log the error
            // Schedule notifications anyway
            if (routine.enabled) {
                (0, notificationScheduler_1.scheduleRoutineNotifications)(routine.id, userId)
                    .catch(err => logger_1.logger.error('Failed to schedule routine notifications:', err));
            }
            return res.status(201).json({
                success: true,
                data: routine,
                warning: 'Routine created but automatic task creation failed',
            });
        }
    }
    catch (error) {
        logger_1.logger.error('Failed to create routine:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to create routine',
        });
    }
});
// GET /api/v1/routines/:routineId
router.get('/:routineId', async (req, res) => {
    try {
        const userId = req.user.id;
        const { routineId } = req.params;
        const routine = await routine_service_1.routineService.getRoutineById(routineId, userId);
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
    }
    catch (error) {
        logger_1.logger.error('Failed to get routine:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to get routine',
        });
    }
});
// PUT /api/v1/routines/:routineId
router.put('/:routineId', async (req, res) => {
    try {
        const userId = req.user.id;
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
        const routine = await routine_service_1.routineService.updateRoutine(routineId, userId, value);
        // If title or description changed, update the first (and only) routine task
        if (value.title !== undefined || value.description !== undefined) {
            try {
                // Get the routine tasks - there should be only one
                const routineTasks = routine.routineTasks || [];
                if (routineTasks.length > 0) {
                    // Update the first task (order 0) with new title/description
                    const taskToUpdate = routineTasks[0];
                    const updateTaskData = {};
                    if (value.title !== undefined) {
                        updateTaskData.title = value.title;
                    }
                    if (value.description !== undefined) {
                        updateTaskData.description = value.description || null;
                    }
                    await routine_service_1.routineService.updateRoutineTask(taskToUpdate.id, userId, updateTaskData);
                    // Reload routine with updated task
                    const updatedRoutine = await routine_service_1.routineService.getRoutineById(routineId, userId);
                    // Reschedule notifications if routine is enabled, otherwise cancel them
                    if (updatedRoutine && updatedRoutine.enabled) {
                        // Cancel existing notifications first
                        await (0, notificationScheduler_1.cancelRoutineNotifications)(routineId, userId);
                        // Schedule new notifications
                        (0, notificationScheduler_1.scheduleRoutineNotifications)(routineId, userId)
                            .catch(err => logger_1.logger.error('Failed to schedule routine notifications:', err));
                    }
                    else {
                        // Cancel notifications if routine is disabled
                        (0, notificationScheduler_1.cancelRoutineNotifications)(routineId, userId)
                            .catch(err => logger_1.logger.error('Failed to cancel routine notifications:', err));
                    }
                    return res.json({
                        success: true,
                        data: updatedRoutine || routine,
                    });
                }
            }
            catch (taskError) {
                logger_1.logger.error('Failed to update routine task:', taskError);
                // Continue even if task update fails
            }
        }
        // Reschedule notifications if routine is enabled, otherwise cancel them
        if (routine.enabled) {
            // Cancel existing notifications first
            await (0, notificationScheduler_1.cancelRoutineNotifications)(routineId, userId);
            // Schedule new notifications
            (0, notificationScheduler_1.scheduleRoutineNotifications)(routineId, userId)
                .catch(err => logger_1.logger.error('Failed to schedule routine notifications:', err));
        }
        else {
            // Cancel notifications if routine is disabled
            (0, notificationScheduler_1.cancelRoutineNotifications)(routineId, userId)
                .catch(err => logger_1.logger.error('Failed to cancel routine notifications:', err));
        }
        return res.json({
            success: true,
            data: routine,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to update routine:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to update routine',
        });
    }
});
// DELETE /api/v1/routines/:routineId
router.delete('/:routineId', async (req, res) => {
    try {
        const userId = req.user.id;
        const { routineId } = req.params;
        await routine_service_1.routineService.deleteRoutine(routineId, userId);
        // Cancel all notifications for this routine
        (0, notificationScheduler_1.cancelRoutineNotifications)(routineId, userId)
            .catch(err => logger_1.logger.error('Failed to cancel routine notifications:', err));
        return res.json({
            success: true,
            message: 'Routine deleted successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to delete routine:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete routine',
        });
    }
});
// POST /api/v1/routines/:routineId/tasks
router.post('/:routineId/tasks', async (req, res) => {
    try {
        const userId = req.user.id;
        const { routineId } = req.params;
        const { error, value } = createTaskSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message,
            });
        }
        const task = await routine_service_1.routineService.addTaskToRoutine(routineId, userId, value);
        // Get routine details to schedule notification
        const routine = await routine_service_1.routineService.getRoutineById(routineId, userId);
        if (routine && routine.enabled) {
            const schedule = routine.schedule;
            (0, notificationScheduler_1.scheduleRoutineTaskNotifications)(routineId, userId, routine.title, routine.frequency, schedule, routine.timezone, task.id, task.title, task.reminderTime).catch(err => logger_1.logger.error('Failed to schedule routine task notification:', err));
        }
        return res.status(201).json({
            success: true,
            data: task,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to add task to routine:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to add task',
        });
    }
});
// PUT /api/v1/routines/tasks/:taskId
router.put('/tasks/:taskId', async (req, res) => {
    try {
        const userId = req.user.id;
        const { taskId } = req.params;
        // Get task first to get routineId
        const { getPrismaClient } = await Promise.resolve().then(() => __importStar(require('../../shared/utils/database')));
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
        const task = await routine_service_1.routineService.updateRoutineTask(taskId, userId, req.body);
        // Get routine details to reschedule notification
        const routine = existingTask.routine;
        if (routine.enabled) {
            // Cancel existing notification
            await (0, notificationScheduler_1.cancelRoutineTaskNotifications)(taskId, userId);
            // Schedule new notification
            const schedule = routine.schedule;
            (0, notificationScheduler_1.scheduleRoutineTaskNotifications)(routine.id, userId, routine.title, routine.frequency, schedule, routine.timezone, task.id, task.title, task.reminderTime).catch(err => logger_1.logger.error('Failed to schedule routine task notification:', err));
        }
        else {
            // Cancel notification if routine is disabled
            (0, notificationScheduler_1.cancelRoutineTaskNotifications)(taskId, userId)
                .catch(err => logger_1.logger.error('Failed to cancel routine task notification:', err));
        }
        return res.json({
            success: true,
            data: task,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to update task:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to update task',
        });
    }
});
// DELETE /api/v1/routines/tasks/:taskId
router.delete('/tasks/:taskId', async (req, res) => {
    try {
        const userId = req.user.id;
        const { taskId } = req.params;
        await routine_service_1.routineService.deleteRoutineTask(taskId, userId);
        // Cancel notifications for this task
        (0, notificationScheduler_1.cancelRoutineTaskNotifications)(taskId, userId)
            .catch(err => logger_1.logger.error('Failed to cancel routine task notification:', err));
        return res.json({
            success: true,
            message: 'Task deleted successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to delete task:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete task',
        });
    }
});
// PUT /api/v1/routines/tasks/:taskId/toggle
router.put('/tasks/:taskId/toggle', async (req, res) => {
    try {
        const userId = req.user.id;
        const { taskId } = req.params;
        const { completed } = req.body;
        const task = await routine_service_1.routineService.toggleTaskCompletion(taskId, userId, completed);
        return res.json({
            success: true,
            data: task,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to toggle task:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to toggle task',
        });
    }
});
// POST /api/v1/routines/:routineId/reset
router.post('/:routineId/reset', async (req, res) => {
    try {
        const userId = req.user.id;
        const { routineId } = req.params;
        // Get routine first to check if it exists and is enabled
        const routine = await routine_service_1.routineService.getRoutineById(routineId, userId);
        if (!routine) {
            return res.status(404).json({
                success: false,
                message: 'Routine not found',
            });
        }
        await routine_service_1.routineService.resetRoutineTasks(routineId);
        // Reschedule notifications for the next occurrence after reset if routine is enabled
        if (routine.enabled) {
            (0, notificationScheduler_1.scheduleRoutineNotifications)(routineId, userId)
                .catch(err => logger_1.logger.error('Failed to reschedule routine notifications after reset:', err));
        }
        return res.json({
            success: true,
            message: 'Routine reset successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to reset routine:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to reset routine',
        });
    }
});
exports.default = router;
