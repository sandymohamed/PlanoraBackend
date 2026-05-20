"use strict";
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
const createReminderSchema = joi_1.default.object({
    targetType: joi_1.default.string().valid('TASK', 'GOAL', 'PROJECT', 'CUSTOM').required(),
    targetId: joi_1.default.string().uuid().optional(),
    title: joi_1.default.string().min(1).max(255).required(),
    note: joi_1.default.string().max(500).optional(),
    triggerType: joi_1.default.string().valid('TIME', 'LOCATION', 'BOTH').required(),
    schedule: joi_1.default.object({
        nextOccurrence: joi_1.default.date().optional(),
        timeOfDay: joi_1.default.string().optional(),
        rrule: joi_1.default.string().optional(),
        timezone: joi_1.default.string().optional(),
    }).required(),
    geo: joi_1.default.object({
        latitude: joi_1.default.number().min(-90).max(90).required(),
        longitude: joi_1.default.number().min(-180).max(180).required(),
        radius: joi_1.default.number().min(1).max(10000).required(),
        onEnter: joi_1.default.boolean().optional(),
        onExit: joi_1.default.boolean().optional(),
    }).optional(),
});
const updateReminderSchema = joi_1.default.object({
    title: joi_1.default.string().min(1).max(255).optional(),
    note: joi_1.default.string().max(500).optional(),
    triggerType: joi_1.default.string().valid('TIME', 'LOCATION', 'BOTH').optional(),
    schedule: joi_1.default.object({
        nextOccurrence: joi_1.default.date().optional(),
        timeOfDay: joi_1.default.string().optional(),
        rrule: joi_1.default.string().optional(),
        timezone: joi_1.default.string().optional(),
    }).optional(),
    geo: joi_1.default.object({
        latitude: joi_1.default.number().min(-90).max(90).required(),
        longitude: joi_1.default.number().min(-180).max(180).required(),
        radius: joi_1.default.number().min(1).max(10000).required(),
        onEnter: joi_1.default.boolean().optional(),
        onExit: joi_1.default.boolean().optional(),
    }).optional(),
});
// GET /api/v1/reminders
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 20, targetType, triggerType } = req.query;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const where = {
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
        const filteredReminders = await Promise.all(reminders.map(async (reminder) => {
            // Check if this is a routine reminder
            const schedule = reminder.schedule;
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
        }));
        // Remove null entries
        const validReminders = filteredReminders.filter((r) => r !== null);
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
    }
    catch (error) {
        logger_1.logger.error('Failed to get reminders:', error);
        throw error;
    }
});
// GET /api/v1/reminders/:id
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const reminder = await prisma.reminder.findFirst({
            where: {
                id,
                userId,
            },
        });
        if (!reminder) {
            throw new types_1.NotFoundError('Reminder');
        }
        res.json({
            success: true,
            data: reminder,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get reminder:', error);
        throw error;
    }
});
// POST /api/v1/reminders
router.post('/', async (req, res) => {
    try {
        const { error, value } = createReminderSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const reminder = await prisma.reminder.create({
            data: {
                ...value,
                userId,
                schedule: value.schedule,
                geo: value.geo,
            },
        });
        logger_1.logger.info('Reminder created successfully', { reminderId: reminder.id, userId });
        res.status(201).json({
            success: true,
            data: reminder,
            message: 'Reminder created successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to create reminder:', error);
        throw error;
    }
});
// PUT /api/v1/reminders/:id
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = updateReminderSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const reminder = await prisma.reminder.findFirst({
            where: { id, userId },
        });
        if (!reminder) {
            throw new types_1.NotFoundError('Reminder');
        }
        const updatedReminder = await prisma.reminder.update({
            where: { id },
            data: {
                ...value,
                schedule: value.schedule,
                geo: value.geo,
            },
        });
        logger_1.logger.info('Reminder updated successfully', { reminderId: id, userId });
        res.json({
            success: true,
            data: updatedReminder,
            message: 'Reminder updated successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to update reminder:', error);
        throw error;
    }
});
// DELETE /api/v1/reminders/:id
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const reminder = await prisma.reminder.findFirst({
            where: { id, userId },
        });
        if (!reminder) {
            throw new types_1.NotFoundError('Reminder');
        }
        await prisma.reminder.delete({
            where: { id },
        });
        logger_1.logger.info('Reminder deleted successfully', { reminderId: id, userId });
        res.json({
            success: true,
            message: 'Reminder deleted successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to delete reminder:', error);
        throw error;
    }
});
// POST /api/v1/reminders/:id/trigger
router.post('/:id/trigger', async (req, res) => {
    try {
        const { id } = req.params;
        const { triggerType } = req.body;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const reminder = await prisma.reminder.findFirst({
            where: { id, userId },
        });
        if (!reminder) {
            throw new types_1.NotFoundError('Reminder');
        }
        // TODO: Process reminder trigger
        // This would typically send notifications, update status, etc.
        logger_1.logger.info('Reminder triggered', { reminderId: id, triggerType, userId });
        res.json({
            success: true,
            message: 'Reminder triggered successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to trigger reminder:', error);
        throw error;
    }
});
exports.default = router;
