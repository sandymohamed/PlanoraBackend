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
const createTimerSchema = joi_1.default.object({
    title: joi_1.default.string().min(1).max(255).required(),
    duration: joi_1.default.number().min(1).max(1440).required(), // max 24 hours in minutes
});
const updateTimerSchema = joi_1.default.object({
    title: joi_1.default.string().min(1).max(255).optional(),
    duration: joi_1.default.number().min(1).max(1440).optional(),
    isRunning: joi_1.default.boolean().optional(),
    isPaused: joi_1.default.boolean().optional(),
    remainingTime: joi_1.default.number().min(0).optional(),
});
// GET /api/v1/timers
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const [timers, total] = await Promise.all([
            prisma.timer.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                skip: (Number(page) - 1) * Number(limit),
                take: Number(limit),
            }),
            prisma.timer.count({ where: { userId } }),
        ]);
        res.json({
            success: true,
            data: timers,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                totalPages: Math.ceil(total / Number(limit)),
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get timers:', error);
        throw error;
    }
});
// GET /api/v1/timers/:id
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const timer = await prisma.timer.findFirst({
            where: {
                id,
                userId,
            },
        });
        if (!timer) {
            throw new types_1.NotFoundError('Timer');
        }
        res.json({
            success: true,
            data: timer,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get timer:', error);
        throw error;
    }
});
// POST /api/v1/timers
router.post('/', async (req, res) => {
    try {
        const { error, value } = createTimerSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const timer = await prisma.timer.create({
            data: {
                ...value,
                userId,
                remainingTime: value.duration * 60, // convert minutes to seconds
            },
        });
        logger_1.logger.info('Timer created successfully', { timerId: timer.id, userId });
        res.status(201).json({
            success: true,
            data: timer,
            message: 'Timer created successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to create timer:', error);
        throw error;
    }
});
// PUT /api/v1/timers/:id
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = updateTimerSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const timer = await prisma.timer.findFirst({
            where: { id, userId },
        });
        if (!timer) {
            throw new types_1.NotFoundError('Timer');
        }
        const updateData = { ...value };
        // If duration is being updated, reset remaining time
        if (value.duration !== undefined) {
            updateData.remainingTime = value.duration * 60;
        }
        const updatedTimer = await prisma.timer.update({
            where: { id },
            data: updateData,
        });
        logger_1.logger.info('Timer updated successfully', { timerId: id, userId });
        res.json({
            success: true,
            data: updatedTimer,
            message: 'Timer updated successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to update timer:', error);
        throw error;
    }
});
// DELETE /api/v1/timers/:id
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const timer = await prisma.timer.findFirst({
            where: { id, userId },
        });
        if (!timer) {
            throw new types_1.NotFoundError('Timer');
        }
        await prisma.timer.delete({
            where: { id },
        });
        logger_1.logger.info('Timer deleted successfully', { timerId: id, userId });
        res.json({
            success: true,
            message: 'Timer deleted successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to delete timer:', error);
        throw error;
    }
});
// POST /api/v1/timers/:id/start
router.post('/:id/start', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const timer = await prisma.timer.findFirst({
            where: { id, userId },
        });
        if (!timer) {
            throw new types_1.NotFoundError('Timer');
        }
        // Stop any other running timers for this user
        await prisma.timer.updateMany({
            where: {
                userId,
                isRunning: true,
                id: { not: id }
            },
            data: {
                isRunning: false,
                isPaused: false
            },
        });
        const updatedTimer = await prisma.timer.update({
            where: { id },
            data: {
                isRunning: true,
                isPaused: false,
                isCompleted: false,
            },
        });
        // Create a new session
        await prisma.timerSession.create({
            data: {
                timerId: id,
                userId,
                startTime: new Date(),
                duration: 0,
            },
        });
        logger_1.logger.info('Timer started', { timerId: id, userId });
        res.json({
            success: true,
            data: updatedTimer,
            message: 'Timer started successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to start timer:', error);
        throw error;
    }
});
// POST /api/v1/timers/:id/pause
router.post('/:id/pause', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const timer = await prisma.timer.findFirst({
            where: { id, userId },
        });
        if (!timer) {
            throw new types_1.NotFoundError('Timer');
        }
        const updatedTimer = await prisma.timer.update({
            where: { id },
            data: {
                isRunning: false,
                isPaused: true,
            },
        });
        // Update the current session
        const currentSession = await prisma.timerSession.findFirst({
            where: {
                timerId: id,
                userId,
                endTime: null,
            },
            orderBy: { startTime: 'desc' },
        });
        if (currentSession) {
            const sessionDuration = Math.floor((Date.now() - currentSession.startTime.getTime()) / 1000);
            await prisma.timerSession.update({
                where: { id: currentSession.id },
                data: { duration: sessionDuration },
            });
        }
        logger_1.logger.info('Timer paused', { timerId: id, userId });
        res.json({
            success: true,
            data: updatedTimer,
            message: 'Timer paused successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to pause timer:', error);
        throw error;
    }
});
// POST /api/v1/timers/:id/stop
router.post('/:id/stop', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const timer = await prisma.timer.findFirst({
            where: { id, userId },
        });
        if (!timer) {
            throw new types_1.NotFoundError('Timer');
        }
        const updatedTimer = await prisma.timer.update({
            where: { id },
            data: {
                isRunning: false,
                isPaused: false,
                isCompleted: true,
                remainingTime: 0,
            },
        });
        // Complete the current session
        const currentSession = await prisma.timerSession.findFirst({
            where: {
                timerId: id,
                userId,
                endTime: null,
            },
            orderBy: { startTime: 'desc' },
        });
        if (currentSession) {
            const sessionDuration = Math.floor((Date.now() - currentSession.startTime.getTime()) / 1000);
            await prisma.timerSession.update({
                where: { id: currentSession.id },
                data: {
                    endTime: new Date(),
                    duration: sessionDuration,
                    isCompleted: true,
                },
            });
        }
        logger_1.logger.info('Timer stopped', { timerId: id, userId });
        res.json({
            success: true,
            data: updatedTimer,
            message: 'Timer stopped successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to stop timer:', error);
        throw error;
    }
});
// POST /api/v1/timers/:id/reset
router.post('/:id/reset', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const timer = await prisma.timer.findFirst({
            where: { id, userId },
        });
        if (!timer) {
            throw new types_1.NotFoundError('Timer');
        }
        const updatedTimer = await prisma.timer.update({
            where: { id },
            data: {
                isRunning: false,
                isPaused: false,
                isCompleted: false,
                remainingTime: timer.duration * 60, // reset to original duration
            },
        });
        logger_1.logger.info('Timer reset', { timerId: id, userId });
        res.json({
            success: true,
            data: updatedTimer,
            message: 'Timer reset successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to reset timer:', error);
        throw error;
    }
});
exports.default = router;
