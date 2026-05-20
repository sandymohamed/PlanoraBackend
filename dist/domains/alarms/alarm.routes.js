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
const notificationScheduler_1 = require("../../infrastructure/queue/notificationScheduler");
const router = (0, express_1.Router)();
// Apply authentication to all routes
router.use(auth_1.authenticateToken);
const createAlarmSchema = joi_1.default.object({
    title: joi_1.default.string().min(1).max(255).required(),
    time: joi_1.default.date().required(),
    timezone: joi_1.default.string().optional(),
    recurrenceRule: joi_1.default.string().optional(),
    toneUrl: joi_1.default.string().optional(),
    smartWakeWindow: joi_1.default.number().min(5).max(60).optional(),
    linkedTaskId: joi_1.default.string().uuid().optional(),
    enabled: joi_1.default.boolean().optional(),
    snoozeConfig: joi_1.default.object({
        duration: joi_1.default.number().min(1).max(60).required(),
        maxSnoozes: joi_1.default.number().min(0).max(10).required(),
        snoozeCount: joi_1.default.number().min(0).optional(),
    }).optional(),
});
const updateAlarmSchema = joi_1.default.object({
    title: joi_1.default.string().min(1).max(255).optional(),
    time: joi_1.default.date().optional(),
    timezone: joi_1.default.string().optional(),
    recurrenceRule: joi_1.default.string().optional(),
    toneUrl: joi_1.default.string().optional(),
    smartWakeWindow: joi_1.default.number().min(5).max(60).optional(),
    linkedTaskId: joi_1.default.string().uuid().optional(),
    enabled: joi_1.default.boolean().optional(),
    snoozeConfig: joi_1.default.object({
        duration: joi_1.default.number().min(1).max(60).required(),
        maxSnoozes: joi_1.default.number().min(0).max(10).required(),
        snoozeCount: joi_1.default.number().min(0).optional(),
    }).optional(),
});
// GET /api/v1/alarms
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 20, enabled } = req.query;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const where = {
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
    }
    catch (error) {
        logger_1.logger.error('Failed to get alarms:', error);
        throw error;
    }
});
// GET /api/v1/alarms/:id
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const alarm = await prisma.alarm.findFirst({
            where: {
                id,
                userId,
            },
        });
        if (!alarm) {
            throw new types_1.NotFoundError('Alarm');
        }
        res.json({
            success: true,
            data: alarm,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get alarm:', error);
        throw error;
    }
});
// POST /api/v1/alarms
router.post('/', async (req, res) => {
    try {
        const { error, value } = createAlarmSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const alarm = await prisma.alarm.create({
            data: {
                ...value,
                userId,
                snoozeConfig: value.snoozeConfig,
            },
        });
        logger_1.logger.info('Alarm created successfully', { alarmId: alarm.id, userId });
        // NOTE: Backend push notifications are DISABLED for alarms
        // Native Android AlarmManager handles all alarm ringing via AlarmPlayerService
        // This prevents double-ringing (backend push notification + native alarm)
        // The frontend schedules native alarms via ReliableAlarmService when alarms are loaded
        // Backend push notifications are only used for task/routine reminders, not alarms
        // Cancel any existing backend push notifications for this alarm (cleanup)
        try {
            await (0, notificationScheduler_1.cancelAlarmPushNotifications)(alarm.id, alarm.userId);
            logger_1.logger.debug('Cleaned up any existing backend push notifications for alarm', { alarmId: alarm.id });
        }
        catch (cancelError) {
            logger_1.logger.warn('Failed to cancel existing alarm push notifications', { alarmId: alarm.id, error: cancelError });
        }
        res.status(201).json({
            success: true,
            data: alarm,
            message: 'Alarm created successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to create alarm:', error);
        throw error;
    }
});
// PUT /api/v1/alarms/:id
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = updateAlarmSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const alarm = await prisma.alarm.findFirst({
            where: { id, userId },
        });
        if (!alarm) {
            throw new types_1.NotFoundError('Alarm');
        }
        const updatedAlarm = await prisma.alarm.update({
            where: { id },
            data: {
                ...value,
                snoozeConfig: value.snoozeConfig,
            },
        });
        logger_1.logger.info('Alarm updated successfully', { alarmId: id, userId });
        // NOTE: Backend push notifications are DISABLED for alarms
        // Native Android AlarmManager handles all alarm ringing via AlarmPlayerService
        // This prevents double-ringing (backend push notification + native alarm)
        // The frontend schedules native alarms via ReliableAlarmService when alarms are loaded/updated
        // Backend push notifications are only used for task/routine reminders, not alarms
        // Cancel any existing backend push notifications for this alarm (cleanup)
        try {
            await (0, notificationScheduler_1.cancelAlarmPushNotifications)(updatedAlarm.id, updatedAlarm.userId);
            logger_1.logger.debug('Cleaned up any existing backend push notifications for alarm', { alarmId: updatedAlarm.id });
        }
        catch (cancelError) {
            logger_1.logger.warn('Failed to cancel existing alarm push notifications', { alarmId: updatedAlarm.id, error: cancelError });
        }
        res.json({
            success: true,
            data: updatedAlarm,
            message: 'Alarm updated successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to update alarm:', error);
        throw error;
    }
});
// DELETE /api/v1/alarms/:id
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        // Check if alarm exists and belongs to user
        const alarm = await prisma.alarm.findFirst({
            where: { id, userId },
        });
        if (!alarm) {
            // Alarm doesn't exist or already deleted - return success (idempotent)
            logger_1.logger.info('Alarm not found or already deleted', { alarmId: id, userId });
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
            await (0, notificationScheduler_1.cancelAlarmPushNotifications)(id, userId);
        }
        catch (notifError) {
            logger_1.logger.warn('Failed to cancel scheduled alarm notifications', { alarmId: id, error: notifError });
        }
        logger_1.logger.info('Alarm deleted successfully', { alarmId: id, userId });
        return res.json({
            success: true,
            message: 'Alarm deleted successfully',
        });
    }
    catch (error) {
        // Handle Prisma error for record not found (P2025)
        if (error.code === 'P2025') {
            logger_1.logger.info('Alarm already deleted', { alarmId: req.params.id, userId: req.user.id });
            return res.json({
                success: true,
                message: 'Alarm deleted successfully',
            });
        }
        logger_1.logger.error('Failed to delete alarm:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to delete alarm',
        });
    }
});
// POST /api/v1/alarms/:id/snooze
router.post('/:id/snooze', async (req, res) => {
    try {
        const { id } = req.params;
        const { duration } = req.body;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const alarm = await prisma.alarm.findFirst({
            where: { id, userId },
        });
        if (!alarm) {
            // Alarm doesn't exist or already deleted - return success (idempotent)
            // This can happen if the routine was rescheduled and the alarm was recreated
            logger_1.logger.info('Alarm not found or already deleted for snooze', { alarmId: id, userId });
            return res.json({
                success: true,
                message: 'Alarm snoozed successfully',
            });
        }
        // TODO: Implement snooze logic
        // For now, we just log it - the actual snooze should update the alarm time
        // by adding the duration (in minutes) to the current alarm time
        logger_1.logger.info('Alarm snoozed', { alarmId: id, duration, userId });
        return res.json({
            success: true,
            message: 'Alarm snoozed successfully',
        });
    }
    catch (error) {
        // Handle Prisma error for record not found (P2025)
        if (error.code === 'P2025') {
            logger_1.logger.info('Alarm already deleted during snooze', { alarmId: req.params.id, userId: req.user.id });
            return res.json({
                success: true,
                message: 'Alarm snoozed successfully',
            });
        }
        logger_1.logger.error('Failed to snooze alarm:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to snooze alarm',
        });
    }
});
// POST /api/v1/alarms/:id/dismiss
router.post('/:id/dismiss', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const alarm = await prisma.alarm.findFirst({
            where: { id, userId },
        });
        if (!alarm) {
            // Alarm doesn't exist or already deleted - return success (idempotent)
            logger_1.logger.info('Alarm not found or already deleted for dismiss', { alarmId: id, userId });
            return res.json({
                success: true,
                message: 'Alarm dismissed successfully',
            });
        }
        // TODO: Implement dismiss logic (e.g., mark as dismissed, update last dismissed time)
        logger_1.logger.info('Alarm dismissed', { alarmId: id, userId });
        return res.json({
            success: true,
            message: 'Alarm dismissed successfully',
        });
    }
    catch (error) {
        // Handle Prisma error for record not found (P2025)
        if (error.code === 'P2025') {
            logger_1.logger.info('Alarm already deleted during dismiss', { alarmId: req.params.id, userId: req.user.id });
            return res.json({
                success: true,
                message: 'Alarm dismissed successfully',
            });
        }
        logger_1.logger.error('Failed to dismiss alarm:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to dismiss alarm',
        });
    }
});
// POST /api/v1/alarms/cancel-all-pending
// Cancel all pending alarm notifications for the current user
router.post('/cancel-all-pending', async (req, res) => {
    try {
        const userId = req.user.id;
        const cancelledCount = await (0, notificationScheduler_1.cancelAllPendingAlarmNotifications)(userId);
        logger_1.logger.info(`Cancelled ${cancelledCount} pending alarm notifications for user ${userId}`);
        return res.json({
            success: true,
            message: `Cancelled ${cancelledCount} pending alarm notifications`,
            cancelledCount,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to cancel all pending alarm notifications:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to cancel pending alarm notifications',
            message: error.message,
        });
    }
});
exports.default = router;
