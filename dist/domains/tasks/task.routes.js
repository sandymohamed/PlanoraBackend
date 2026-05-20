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
const database_1 = require("../../shared/utils/database");
const auth_1 = require("../../shared/middleware/auth");
const types_1 = require("../../shared/types");
const logger_1 = require("../../shared/utils/logger");
const router = (0, express_1.Router)();
// Apply authentication to all routes
router.use(auth_1.authenticateToken);
const createTaskSchema = joi_1.default.object({
    title: joi_1.default.string().min(1).max(255).required(),
    description: joi_1.default.string().max(1000).allow('', null).optional().default(''),
    assigneeId: joi_1.default.string().uuid().allow(null).optional(),
    projectId: joi_1.default.string().uuid().allow(null).optional(),
    goalId: joi_1.default.string().uuid().allow(null).optional(),
    milestoneId: joi_1.default.string().uuid().allow(null).optional(),
    priority: joi_1.default.string().valid('LOW', 'MEDIUM', 'HIGH', 'URGENT').optional(),
    status: joi_1.default.string().valid('TODO', 'IN_PROGRESS', 'DONE', 'ARCHIVED').optional(),
    dueDate: joi_1.default.date().allow(null).optional(),
    dueTime: joi_1.default.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).allow(null).optional(),
    recurrenceRule: joi_1.default.string().allow(null).optional(),
    // tags: Joi.array().items(Joi.string()).allow(null).optional(),
    metadata: joi_1.default.object().optional(),
});
const updateTaskSchema = joi_1.default.object({
    title: joi_1.default.string().min(1).max(255).optional(),
    description: joi_1.default.string().max(1000).allow('', null).optional(),
    assigneeId: joi_1.default.string().uuid().allow(null).optional(),
    projectId: joi_1.default.string().uuid().allow(null).optional(),
    goalId: joi_1.default.string().uuid().allow(null).optional(),
    milestoneId: joi_1.default.string().uuid().allow(null).optional(),
    priority: joi_1.default.string().valid('LOW', 'MEDIUM', 'HIGH', 'URGENT').optional(),
    status: joi_1.default.string().valid('TODO', 'IN_PROGRESS', 'DONE', 'ARCHIVED').optional(),
    dueDate: joi_1.default.date().allow(null).optional(),
    dueTime: joi_1.default.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).allow(null).optional(),
    recurrenceRule: joi_1.default.string().allow(null).optional(),
    metadata: joi_1.default.object().optional(),
    tags: joi_1.default.array().items(joi_1.default.string()).optional(), // Allow tags but will be ignored (not in Task model, only Project has tags)
});
const reorderTasksSchema = joi_1.default.object({
    taskOrders: joi_1.default.array().items(joi_1.default.object({
        id: joi_1.default.string().uuid().required(),
        order: joi_1.default.number().integer().min(0).required(),
    })).min(1).required(),
});
// GET /api/v1/tasks
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 20, search, status, priority, projectId, goalId, assigneeId } = req.query;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const where = {
            AND: [
                {
                    OR: [
                        { creatorId: userId },
                        { assigneeId: userId },
                        { project: { members: { some: { userId } } } },
                    ],
                },
            ],
        };
        if (search) {
            where.AND.push({
                OR: [
                    { title: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } },
                ],
            });
        }
        if (status) {
            where.status = status;
        }
        if (priority) {
            where.priority = priority;
        }
        if (projectId) {
            where.projectId = projectId;
        }
        if (goalId) {
            where.goalId = goalId;
            logger_1.logger.info(`Filtering tasks by goalId: ${goalId}`);
        }
        else {
            // Log that we're NOT filtering by goalId, so all tasks should be returned
            logger_1.logger.info('Fetching all tasks (no goalId filter) - should include regular tasks');
        }
        if (assigneeId) {
            where.assigneeId = assigneeId;
        }
        const tasks = await prisma.task.findMany({
            where,
            include: {
                creator: {
                    select: { id: true, name: true, email: true },
                },
                assignee: {
                    select: { id: true, name: true, email: true },
                },
                project: {
                    select: { id: true, title: true },
                },
                goal: {
                    select: { id: true, title: true },
                },
                milestone: {
                    select: { id: true, title: true },
                },
            },
            orderBy: { order: 'asc' },
            skip: (Number(page) - 1) * Number(limit),
            take: Number(limit),
        });
        // Log task breakdown BEFORE adding routine tasks
        logger_1.logger.info(`Retrieved ${tasks.length} tasks from database`, {
            total: tasks.length,
            withGoalId: tasks.filter(t => t.goalId).length,
            withoutGoalId: tasks.filter(t => !t.goalId).length,
            withProjectId: tasks.filter(t => t.projectId).length,
            regularTasks: tasks.filter(t => !t.goalId && !t.projectId).length,
            goalId: goalId || 'none',
            whereClause: JSON.stringify(where),
        });
        // Get routine tasks as tasks (but we removed routines from tasks screen per user request)
        // So skip routine tasks for now
        // const { routineService } = await import('../routines/routine.service');
        // const routineTasks = await routineService.getRoutineTasksAsTasks(userId);
        // Merge routine tasks with regular tasks
        // For now, only return regular tasks (routines removed per user request)
        let allTasks = [...tasks]; // Remove routine tasks: [...tasks, ...routineTasks];
        // Apply filters to routine tasks if needed
        if (status) {
            allTasks = allTasks.filter(t => t.status === status);
        }
        if (priority) {
            allTasks = allTasks.filter(t => t.priority === priority);
        }
        if (search) {
            const searchLower = search.toLowerCase();
            allTasks = allTasks.filter(t => t.title.toLowerCase().includes(searchLower) ||
                (t.description && t.description.toLowerCase().includes(searchLower)));
        }
        // Sort all tasks by order
        allTasks.sort((a, b) => (a.order || 0) - (b.order || 0));
        // Log final task breakdown
        logger_1.logger.info(`Final tasks after filtering (before pagination):`, {
            total: allTasks.length,
            withGoalId: allTasks.filter(t => t.goalId).length,
            withoutGoalId: allTasks.filter(t => !t.goalId).length,
            withProjectId: allTasks.filter(t => t.projectId).length,
            regularTasks: allTasks.filter(t => !t.goalId && !t.projectId).length,
        });
        // Apply pagination
        const paginatedTasks = allTasks.slice((Number(page) - 1) * Number(limit), Number(page) * Number(limit));
        logger_1.logger.info(`Returning paginated tasks:`, {
            page: Number(page),
            limit: Number(limit),
            paginatedCount: paginatedTasks.length,
            total: allTasks.length,
            regularTasksInPage: paginatedTasks.filter(t => !t.goalId && !t.projectId).length,
        });
        res.json({
            success: true,
            data: paginatedTasks,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total: allTasks.length,
                totalPages: Math.ceil(allTasks.length / Number(limit)),
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get tasks:', error);
        throw error;
    }
});
// GET /api/v1/tasks/:id
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const task = await prisma.task.findFirst({
            where: {
                id,
                OR: [
                    { creatorId: userId },
                    { assigneeId: userId },
                    { project: { members: { some: { userId } } } },
                ],
            },
            include: {
                creator: {
                    select: { id: true, name: true, email: true },
                },
                assignee: {
                    select: { id: true, name: true, email: true },
                },
                project: {
                    select: { id: true, title: true },
                },
                goal: {
                    select: { id: true, title: true },
                },
                milestone: {
                    select: { id: true, title: true },
                },
            },
        });
        if (!task) {
            throw new types_1.NotFoundError('Task');
        }
        res.json({
            success: true,
            data: task,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get task:', error);
        throw error;
    }
});
// POST /api/v1/tasks
router.post('/', async (req, res) => {
    try {
        const { error, value } = createTaskSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        // Check project access if projectId is provided
        if (value.projectId) {
            const project = await prisma.project.findFirst({
                where: {
                    id: value.projectId,
                    OR: [
                        { ownerId: userId },
                        { members: { some: { userId } } },
                    ],
                },
            });
            if (!project) {
                throw new types_1.AuthorizationError('You do not have access to this project');
            }
        }
        // Check goal access if goalId is provided
        if (value.goalId) {
            const goal = await prisma.goal.findFirst({
                where: {
                    id: value.goalId,
                    userId,
                },
            });
            if (!goal) {
                throw new types_1.AuthorizationError('You do not have access to this goal');
            }
        }
        // Get the next order value for this user's tasks
        const lastTask = await prisma.task.findFirst({
            where: {
                OR: [
                    { creatorId: userId },
                    { assigneeId: userId },
                    { project: { members: { some: { userId } } } },
                ],
            },
            orderBy: { order: 'desc' },
            select: { order: true },
        });
        const nextOrder = (lastTask?.order || 0) + 1;
        const task = await prisma.task.create({
            data: {
                ...value,
                creatorId: userId,
                order: nextOrder,
            },
            include: {
                creator: {
                    select: { id: true, name: true, email: true },
                },
                assignee: {
                    select: { id: true, name: true, email: true },
                },
                project: {
                    select: { id: true, title: true },
                },
                goal: {
                    select: { id: true, title: true },
                },
                milestone: {
                    select: { id: true, title: true },
                },
            },
        });
        const notificationScheduler = await Promise.resolve().then(() => __importStar(require('../../infrastructure/queue/notificationScheduler')));
        // Schedule notifications for due date if provided
        if (task.dueDate) {
            const taskUserId = task.assigneeId || task.creatorId;
            const dueTime = value.dueTime || task.dueTime || null;
            logger_1.logger.info('Scheduling task notifications', {
                taskId: task.id,
                userId: taskUserId,
                dueDate: task.dueDate,
                dueTime
            });
            notificationScheduler.scheduleTaskDueDateNotifications(task.id, taskUserId, task.dueDate, task.title, dueTime)
                .catch(err => logger_1.logger.error('Failed to schedule task notifications:', err));
        }
        // Send push notification to creator for task creation (testing)
        notificationScheduler.sendTaskCreatedNotification(task.id, userId, task.title, { projectTitle: task.project?.title || undefined }).catch(err => logger_1.logger.error('Failed to send task created notification:', err));
        // Send assignment notification if task is assigned
        if (task.assigneeId && task.assigneeId !== userId) {
            const creator = task.creator;
            notificationScheduler.sendTaskAssignmentNotification(task.id, task.assigneeId, task.title, creator?.name || creator?.email).catch(err => logger_1.logger.error('Failed to send assignment notification:', err));
        }
        res.status(201).json({
            success: true,
            data: task,
            message: 'Task created successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to create task:', error);
        throw error;
    }
});
// PUT /api/v1/tasks/:id
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = updateTaskSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        // Check if this is a routine task - only allow status updates
        if (id.startsWith('routine_')) {
            // Extract routine task ID (handle multiple formats):
            // - routine_taskId_day_X (weekly format from backend)
            // - routine_taskId_yyyy-MM-dd (daily format from calendar)
            // - routine_taskId (simple format)
            let routineTaskId = id.replace('routine_', '');
            // Remove _day_X suffix (e.g., "_day_1" -> "")
            if (routineTaskId.includes('_day_')) {
                routineTaskId = routineTaskId.split('_day_')[0];
            }
            // Remove date suffix (e.g., "_2025-11-18" -> "")
            else if (routineTaskId.match(/_\d{4}-\d{2}-\d{2}$/)) {
                routineTaskId = routineTaskId.replace(/_\d{4}-\d{2}-\d{2}$/, '');
            }
            const { routineService } = await Promise.resolve().then(() => __importStar(require('../routines/routine.service')));
            // Only allow status updates for routine tasks
            if (value.status === 'DONE') {
                await routineService.toggleTaskCompletion(routineTaskId, userId, true);
            }
            else if (value.status === 'TODO') {
                await routineService.toggleTaskCompletion(routineTaskId, userId, false);
            }
            // Get the updated routine task as a task object
            const routineTasks = await routineService.getRoutineTasksAsTasks(userId);
            // Try to find task by exact ID match first
            let updatedTask = routineTasks.find(t => t.id === id);
            // If not found, try to find by routineTaskId in metadata (handles ID format mismatches)
            if (!updatedTask) {
                updatedTask = routineTasks.find(t => t.metadata?.routineTaskId === routineTaskId);
                // If found by metadata, update the ID to match the requested format
                if (updatedTask) {
                    updatedTask = {
                        ...updatedTask,
                        id: id, // Use the requested ID format
                    };
                }
            }
            if (!updatedTask) {
                throw new types_1.NotFoundError('Task not found');
            }
            logger_1.logger.info('Routine task updated successfully', { taskId: id, routineTaskId, userId });
            return res.json({
                success: true,
                data: updatedTask,
                message: 'Task updated successfully',
            });
        }
        // Check if user can update this task
        const existingTask = await prisma.task.findFirst({
            where: {
                id,
                OR: [
                    { creatorId: userId },
                    { assigneeId: userId },
                    { project: { members: { some: { userId, role: { in: ['OWNER', 'EDITOR'] } } } } },
                ],
            },
        });
        if (!existingTask) {
            throw new types_1.NotFoundError('Task');
        }
        // Remove tags from update data since Task model doesn't have tags field (only Project has tags)
        const { tags, ...updateData } = value;
        const task = await prisma.task.update({
            where: { id },
            data: updateData,
            include: {
                creator: {
                    select: { id: true, name: true, email: true },
                },
                assignee: {
                    select: { id: true, name: true, email: true },
                },
                project: {
                    select: { id: true, title: true },
                },
                goal: {
                    select: { id: true, title: true },
                },
                milestone: {
                    select: { id: true, title: true },
                },
            },
        });
        // Reschedule notifications if due date or time changed
        if (value.dueDate !== undefined || value.dueTime !== undefined) {
            const { scheduleTaskDueDateNotifications } = await Promise.resolve().then(() => __importStar(require('../../infrastructure/queue/notificationScheduler')));
            const taskUserId = task.assigneeId || task.creatorId;
            const dueTime = value.dueTime !== undefined ? value.dueTime : (task.dueTime || null);
            logger_1.logger.info('Rescheduling task notifications', {
                taskId: task.id,
                userId: taskUserId,
                dueDate: task.dueDate,
                dueTime
            });
            if (task.dueDate) {
                scheduleTaskDueDateNotifications(task.id, taskUserId, task.dueDate, task.title, dueTime)
                    .catch(err => logger_1.logger.error('Failed to reschedule task notifications:', err));
            }
        }
        // Send assignment notification if task was just assigned
        if (value.assigneeId && value.assigneeId !== existingTask.assigneeId && value.assigneeId !== userId && task.assigneeId) {
            const { sendTaskAssignmentNotification } = await Promise.resolve().then(() => __importStar(require('../../infrastructure/queue/notificationScheduler')));
            const creator = task.creator;
            sendTaskAssignmentNotification(task.id, task.assigneeId, task.title, creator?.name || creator?.email).catch(err => logger_1.logger.error('Failed to send assignment notification:', err));
        }
        logger_1.logger.info('Task updated successfully', { taskId: id, userId });
        return res.json({
            success: true,
            data: task,
            message: 'Task updated successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to update task:', error);
        throw error;
    }
});
// DELETE /api/v1/tasks/:id
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        // Check if this is a routine task
        if (id.startsWith('routine_')) {
            // Extract routine task ID (handle multiple formats):
            // - routine_taskId_day_X (weekly format from backend)
            // - routine_taskId_yyyy-MM-dd (daily format from calendar)
            // - routine_taskId (simple format)
            let routineTaskId = id.replace('routine_', '');
            // Remove _day_X suffix (e.g., "_day_1" -> "")
            if (routineTaskId.includes('_day_')) {
                routineTaskId = routineTaskId.split('_day_')[0];
            }
            // Remove date suffix (e.g., "_2025-11-18" -> "")
            else if (routineTaskId.match(/_\d{4}-\d{2}-\d{2}$/)) {
                routineTaskId = routineTaskId.replace(/_\d{4}-\d{2}-\d{2}$/, '');
            }
            const { routineService } = await Promise.resolve().then(() => __importStar(require('../routines/routine.service')));
            const { cancelRoutineTaskNotifications } = await Promise.resolve().then(() => __importStar(require('../../infrastructure/queue/notificationScheduler')));
            // Delete the routine task
            await routineService.deleteRoutineTask(routineTaskId, userId);
            // Cancel notifications for this task
            cancelRoutineTaskNotifications(routineTaskId, userId)
                .catch(err => logger_1.logger.error('Failed to cancel routine task notification:', err));
            logger_1.logger.info('Routine task deleted successfully', { taskId: id, routineTaskId, userId });
            return res.json({
                success: true,
                message: 'Task deleted successfully',
            });
        }
        // Regular task deletion
        // Check if user can delete this task
        const task = await prisma.task.findFirst({
            where: {
                id,
                OR: [
                    { creatorId: userId },
                    { project: { members: { some: { userId, role: { in: ['OWNER', 'EDITOR'] } } } } },
                ],
            },
        });
        if (!task) {
            throw new types_1.NotFoundError('Task not found');
        }
        await prisma.task.delete({
            where: { id },
        });
        logger_1.logger.info('Task deleted successfully', { taskId: id, userId });
        return res.json({
            success: true,
            message: 'Task deleted successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to delete task:', error);
        throw error;
    }
});
// POST /api/v1/tasks/:id/assign
router.post('/:id/assign', async (req, res) => {
    try {
        const { id } = req.params;
        const { assigneeId } = req.body;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        // Check if user can assign this task
        const task = await prisma.task.findFirst({
            where: {
                id,
                OR: [
                    { creatorId: userId },
                    { project: { members: { some: { userId, role: { in: ['OWNER', 'EDITOR'] } } } } },
                ],
            },
        });
        if (!task) {
            throw new types_1.NotFoundError('Task');
        }
        const updatedTask = await prisma.task.update({
            where: { id },
            data: { assigneeId },
            include: {
                creator: {
                    select: { id: true, name: true, email: true },
                },
                assignee: {
                    select: { id: true, name: true, email: true },
                },
                project: {
                    select: { id: true, title: true },
                },
                goal: {
                    select: { id: true, title: true },
                },
                milestone: {
                    select: { id: true, title: true },
                },
            },
        });
        // Send assignment notification
        if (assigneeId && assigneeId !== userId) {
            const { sendTaskAssignmentNotification } = await Promise.resolve().then(() => __importStar(require('../../infrastructure/queue/notificationScheduler')));
            const creator = updatedTask.creator;
            sendTaskAssignmentNotification(updatedTask.id, assigneeId, updatedTask.title, creator?.name || creator?.email).catch(err => logger_1.logger.error('Failed to send assignment notification:', err));
        }
        logger_1.logger.info('Task assigned successfully', { taskId: id, assigneeId, userId });
        res.json({
            success: true,
            data: updatedTask,
            message: 'Task assigned successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to assign task:', error);
        throw error;
    }
});
// PATCH /api/v1/tasks/reorder
router.patch('/reorder', async (req, res) => {
    try {
        const { error, value } = reorderTasksSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const { taskOrders } = value;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        // Verify that all tasks belong to the user
        const taskIds = taskOrders.map((to) => to.id).filter((id) => id !== null);
        const userTasks = await prisma.task.findMany({
            where: {
                id: { in: taskIds },
                OR: [
                    { creatorId: userId },
                    { assigneeId: userId },
                    { project: { members: { some: { userId } } } },
                ],
            },
            select: { id: true },
        });
        if (userTasks.length !== taskIds.length) {
            throw new types_1.AuthorizationError('You do not have access to reorder some of these tasks');
        }
        // Update task orders in a transaction
        await prisma.$transaction(taskOrders.map((taskOrder) => prisma.task.update({
            where: { id: taskOrder.id },
            data: { order: taskOrder.order },
        })));
        logger_1.logger.info('Tasks reordered successfully', {
            userId,
            taskCount: taskOrders.length,
            taskIds: taskIds
        });
        res.json({
            success: true,
            message: 'Tasks reordered successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to reorder tasks:', error);
        throw error;
    }
});
// PATCH /api/v1/tasks/:id/complete
router.patch('/:id/complete', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        // Check if this is a routine task
        if (id.startsWith('routine_')) {
            // Extract routine task ID (handle both formats: routine_taskId and routine_taskId_day_X)
            const routineTaskId = id.replace('routine_', '').split('_day_')[0];
            const { routineService } = await Promise.resolve().then(() => __importStar(require('../routines/routine.service')));
            // Toggle routine task completion
            await routineService.toggleTaskCompletion(routineTaskId, userId, true);
            // Get the updated routine task as a task object
            const routineTasks = await routineService.getRoutineTasksAsTasks(userId);
            const updatedTask = routineTasks.find(t => t.id === id);
            if (!updatedTask) {
                throw new types_1.NotFoundError('Task');
            }
            logger_1.logger.info('Routine task completed successfully', { taskId: id, userId });
            return res.json({
                success: true,
                data: updatedTask,
                message: 'Task completed successfully',
            });
        }
        // Check if user can complete this task
        const task = await prisma.task.findFirst({
            where: {
                id,
                OR: [
                    { creatorId: userId },
                    { assigneeId: userId },
                    { project: { members: { some: { userId } } } },
                ],
            },
        });
        if (!task) {
            throw new types_1.NotFoundError('Task');
        }
        const updatedTask = await prisma.task.update({
            where: { id },
            data: {
                status: 'DONE',
                completedAt: new Date(),
            },
            include: {
                creator: {
                    select: { id: true, name: true, email: true },
                },
                assignee: {
                    select: { id: true, name: true, email: true },
                },
                project: {
                    select: { id: true, title: true },
                },
                goal: {
                    select: { id: true, title: true },
                },
                milestone: {
                    select: { id: true, title: true },
                },
            },
        });
        logger_1.logger.info('Task completed successfully', { taskId: id, userId });
        return res.json({
            success: true,
            data: updatedTask,
            message: 'Task completed successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to complete task:', error);
        throw error;
    }
});
// PATCH /api/v1/tasks/:id/uncomplete
router.patch('/:id/uncomplete', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        // Check if this is a routine task
        if (id.startsWith('routine_')) {
            // Extract routine task ID (handle both formats: routine_taskId and routine_taskId_day_X)
            const routineTaskId = id.replace('routine_', '').split('_day_')[0];
            const { routineService } = await Promise.resolve().then(() => __importStar(require('../routines/routine.service')));
            // Toggle routine task completion
            await routineService.toggleTaskCompletion(routineTaskId, userId, false);
            // Get the updated routine task as a task object
            const routineTasks = await routineService.getRoutineTasksAsTasks(userId);
            const updatedTask = routineTasks.find(t => t.id === id);
            if (!updatedTask) {
                throw new types_1.NotFoundError('Task');
            }
            logger_1.logger.info('Routine task uncompleted successfully', { taskId: id, userId });
            return res.json({
                success: true,
                data: updatedTask,
                message: 'Task uncompleted successfully',
            });
        }
        // Check if user can uncomplete this task
        const task = await prisma.task.findFirst({
            where: {
                id,
                OR: [
                    { creatorId: userId },
                    { assigneeId: userId },
                    { project: { members: { some: { userId } } } },
                ],
            },
        });
        if (!task) {
            throw new types_1.NotFoundError('Task');
        }
        const updatedTask = await prisma.task.update({
            where: { id },
            data: {
                status: 'TODO',
                completedAt: null,
            },
            include: {
                creator: {
                    select: { id: true, name: true, email: true },
                },
                assignee: {
                    select: { id: true, name: true, email: true },
                },
                project: {
                    select: { id: true, title: true },
                },
                goal: {
                    select: { id: true, title: true },
                },
                milestone: {
                    select: { id: true, title: true },
                },
            },
        });
        logger_1.logger.info('Task uncompleted successfully', { taskId: id, userId });
        return res.json({
            success: true,
            data: updatedTask,
            message: 'Task uncompleted successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to uncomplete task:', error);
        throw error;
    }
});
exports.default = router;
