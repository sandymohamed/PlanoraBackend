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
const ai_service_1 = require("./ai.service");
const logger_1 = require("../../shared/utils/logger");
const router = (0, express_1.Router)();
// Apply authentication to all routes
router.use(auth_1.authenticateToken);
const generatePlanSchema = joi_1.default.object({
    goalId: joi_1.default.string().uuid().required(),
    promptOptions: joi_1.default.object({
        intensity: joi_1.default.string().valid('low', 'medium', 'high').optional(),
        weeklyHours: joi_1.default.number().min(1).max(168).optional(),
        language: joi_1.default.string().valid('en', 'ar').optional(),
        tone: joi_1.default.string().valid('supportive', 'professional', 'casual').optional(),
    }).optional(),
});
// Helper function to calculate milestone date (fallback when AI doesn't provide date)
const calculateMilestoneDate = (now, goalTargetDate, cumulativeDays, totalDuration, goalHasTargetDate) => {
    let milestoneDueDate;
    if (goalHasTargetDate && goalTargetDate) {
        // If goal has target date, distribute milestones from now to target date
        // The last milestone should end on or before the target date
        const progressRatio = cumulativeDays / totalDuration;
        const totalDaysAvailable = Math.ceil((goalTargetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const daysFromStart = Math.floor(totalDaysAvailable * progressRatio);
        milestoneDueDate = new Date(now);
        milestoneDueDate.setDate(now.getDate() + daysFromStart);
        // Ensure the last milestone doesn't exceed the target date
        if (milestoneDueDate > goalTargetDate) {
            milestoneDueDate = new Date(goalTargetDate);
        }
    }
    else {
        // If no target date, use milestone durations from today
        milestoneDueDate = new Date(now);
        milestoneDueDate.setDate(now.getDate() + cumulativeDays);
    }
    return milestoneDueDate;
};
// POST /api/v1/ai/generate-plan
router.post('/generate-plan', async (req, res) => {
    try {
        const { error, value } = generatePlanSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const { goalId, promptOptions = {} } = value;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        // Get the goal
        const goal = await prisma.goal.findFirst({
            where: {
                id: goalId,
                userId,
            },
        });
        if (!goal) {
            return res.status(404).json({
                success: false,
                error: 'Goal not found',
            });
        }
        // Generate the plan using AI
        const plan = await ai_service_1.aiService.generatePlan(goal.title, goal.description || '', goal.targetDate?.toISOString() || new Date().toISOString(), promptOptions);
        // Create milestones and tasks in the database
        const createdMilestones = [];
        const createdTasks = [];
        // Calculate milestone due dates based on goal target date and milestone durations
        const now = new Date();
        now.setHours(0, 0, 0, 0); // Start of today
        const goalTargetDate = goal.targetDate ? new Date(goal.targetDate) : null;
        if (goalTargetDate) {
            goalTargetDate.setHours(23, 59, 59, 999); // Set to end of target day
        }
        // Calculate total duration of all milestones
        const totalDuration = plan.milestones.reduce((sum, m) => sum + m.durationDays, 0);
        // Calculate cumulative days for milestone due dates
        let cumulativeDays = 0;
        for (const milestoneData of plan.milestones) {
            cumulativeDays += milestoneData.durationDays;
            // Calculate milestone due date - prefer AI-generated date if available
            let milestoneDueDate;
            if (milestoneData.targetDate) {
                // Use AI-generated date if provided
                milestoneDueDate = new Date(milestoneData.targetDate);
                // Validate the date is valid
                if (isNaN(milestoneDueDate.getTime())) {
                    // Fallback to calculation if AI date is invalid
                    milestoneDueDate = calculateMilestoneDate(now, goalTargetDate, cumulativeDays, totalDuration, goal.targetDate);
                }
                else {
                    // Ensure AI-generated date doesn't exceed goal target date
                    if (goal.targetDate && goalTargetDate && milestoneDueDate > goalTargetDate) {
                        milestoneDueDate = new Date(goalTargetDate);
                    }
                    // Ensure AI-generated date is not before today
                    if (milestoneDueDate < now) {
                        milestoneDueDate = new Date(now);
                    }
                }
            }
            else {
                // Fallback to calculated date if AI didn't provide one
                milestoneDueDate = calculateMilestoneDate(now, goalTargetDate, cumulativeDays, totalDuration, goal.targetDate);
            }
            const milestone = await prisma.milestone.create({
                data: {
                    goalId: goal.id,
                    title: milestoneData.title,
                    description: milestoneData.description || null,
                    dueDate: milestoneDueDate,
                    status: 'TODO',
                },
            });
            createdMilestones.push(milestone);
            // Schedule notifications for milestone due date
            if (milestone.dueDate) {
                const { scheduleMilestoneDueDateNotifications } = await Promise.resolve().then(() => __importStar(require('../../infrastructure/queue/notificationScheduler')));
                scheduleMilestoneDueDateNotifications(milestone.id, goal.id, userId, milestone.dueDate, milestone.title)
                    .catch(err => logger_1.logger.error('Failed to schedule milestone notifications:', err));
            }
        }
        for (const taskData of plan.tasks) {
            const milestone = createdMilestones[taskData.milestoneIndex];
            // Calculate task due date based on dueOffsetDays from the start
            let taskDueDate;
            if (goal.targetDate && goalTargetDate) {
                // If goal has target date, calculate task date proportionally
                const totalDaysAvailable = Math.ceil((goalTargetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                // Use the maximum duration from all tasks to scale the offset
                const maxTaskOffset = Math.max(...plan.tasks.map(t => t.dueOffsetDays), 1);
                const scaledOffset = Math.floor((taskData.dueOffsetDays / maxTaskOffset) * totalDaysAvailable);
                taskDueDate = new Date(now);
                taskDueDate.setDate(now.getDate() + scaledOffset);
                // Ensure task doesn't exceed goal target date
                if (taskDueDate > goalTargetDate) {
                    taskDueDate = new Date(goalTargetDate);
                }
                // If task belongs to a milestone, ensure it doesn't exceed milestone due date
                if (milestone && milestone.dueDate) {
                    const milestoneDueDate = new Date(milestone.dueDate);
                    if (taskDueDate > milestoneDueDate) {
                        taskDueDate = new Date(milestoneDueDate);
                    }
                }
            }
            else {
                // If no target date, use dueOffsetDays directly from today
                taskDueDate = new Date(now);
                taskDueDate.setDate(now.getDate() + taskData.dueOffsetDays);
            }
            // Ensure task is not in the past
            if (taskDueDate < now) {
                taskDueDate = new Date(now);
            }
            const dueDate = taskDueDate;
            const task = await prisma.task.create({
                data: {
                    title: taskData.title,
                    description: taskData.description,
                    creatorId: userId,
                    goalId: goal.id,
                    milestoneId: milestone?.id,
                    priority: 'MEDIUM',
                    status: 'TODO',
                    dueDate: dueDate,
                    recurrenceRule: taskData.recurrence,
                    metadata: {
                        durationMinutes: taskData.durationMinutes,
                        aiGenerated: true,
                    },
                },
            });
            createdTasks.push(task);
        }
        // Update goal to mark as plan generated
        await prisma.goal.update({
            where: { id: goal.id },
            data: {
                planGenerated: true,
                planSource: 'AI',
            },
        });
        logger_1.logger.info('AI plan generated successfully', {
            goalId,
            userId,
            milestonesCount: createdMilestones.length,
            tasksCount: createdTasks.length,
        });
        // Map milestone dueDate to targetDate for frontend compatibility
        const milestonesWithTargetDate = createdMilestones.map((milestone) => ({
            ...milestone,
            targetDate: milestone.dueDate ? milestone.dueDate.toISOString() : null,
        }));
        return res.json({
            success: true,
            data: {
                plan,
                milestones: milestonesWithTargetDate,
                tasks: createdTasks,
            },
            message: 'Plan generated successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('AI plan generation error:', error);
        // Return error response instead of throwing
        const errorMessage = error instanceof Error ? error.message : 'Failed to generate AI plan';
        const statusCode = error instanceof types_1.ValidationError ? 400 : 500;
        return res.status(statusCode).json({
            success: false,
            error: errorMessage,
            message: 'Failed to generate plan. Please try again or contact support if the issue persists.',
        });
    }
});
// POST /api/v1/ai/generate-simple-plan
router.post('/generate-simple-plan', async (req, res) => {
    try {
        const { goalTitle } = req.body;
        if (!goalTitle) {
            throw new types_1.ValidationError('Goal title is required');
        }
        // Generate a simple plan for testing
        const plan = await ai_service_1.aiService.generateSimplePlan(goalTitle);
        return res.json({
            success: true,
            data: plan,
            message: 'Simple plan generated successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Simple plan generation error:', error);
        // Return error response instead of throwing
        const errorMessage = error instanceof Error ? error.message : 'Failed to generate AI plan';
        const statusCode = error instanceof types_1.ValidationError ? 400 : 500;
        return res.status(statusCode).json({
            success: false,
            error: errorMessage,
            message: 'Failed to generate simple plan. Please try again or contact support if the issue persists.',
        });
    }
});
exports.default = router;
