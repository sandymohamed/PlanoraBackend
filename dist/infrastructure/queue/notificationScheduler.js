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
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleTaskDueDateNotifications = scheduleTaskDueDateNotifications;
exports.scheduleMilestoneDueDateNotifications = scheduleMilestoneDueDateNotifications;
exports.checkAndNotifyOverdueMilestones = checkAndNotifyOverdueMilestones;
exports.scheduleGoalTargetDateNotifications = scheduleGoalTargetDateNotifications;
exports.cancelAlarmPushNotifications = cancelAlarmPushNotifications;
exports.cancelAllPendingAlarmNotifications = cancelAllPendingAlarmNotifications;
exports.scheduleAlarmPushNotification = scheduleAlarmPushNotification;
exports.sendTaskAssignmentNotification = sendTaskAssignmentNotification;
exports.sendTaskCreatedNotification = sendTaskCreatedNotification;
exports.scheduleRoutineTaskNotifications = scheduleRoutineTaskNotifications;
exports.cancelRoutineTaskNotifications = cancelRoutineTaskNotifications;
exports.cancelRoutineNotifications = cancelRoutineNotifications;
exports.scheduleRoutineReminderNotification = scheduleRoutineReminderNotification;
exports.scheduleRoutineNotifications = scheduleRoutineNotifications;
const database_1 = require("../../shared/utils/database");
const logger_1 = require("../../shared/utils/logger");
const queue_service_1 = require("./queue.service");
const queue_service_2 = require("./queue.service");
const IMMEDIATE_NOTIFICATION_DELAY_MS = 1000;
function getImmediateScheduleTime(delayMs = IMMEDIATE_NOTIFICATION_DELAY_MS) {
    return new Date(Date.now() + Math.max(delayMs, 0));
}
const ALARM_NOTIFICATION_TYPE = 'ALARM_TRIGGER';
/**
 * Schedule notifications for task due dates
 * Creates reminders for: 1 day before, 1 hour before, and at due time
 * @param taskId - Task ID
 * @param userId - User ID to send notifications to
 * @param dueDate - Due date (may include time if dueTime is null)
 * @param taskTitle - Task title
 * @param dueTime - Optional time string (HH:mm format)
 */
async function scheduleTaskDueDateNotifications(taskId, userId, dueDate, taskTitle, dueTime) {
    try {
        logger_1.logger.info('scheduleTaskDueDateNotifications called', { taskId, userId, dueDate, dueTime });
        const prisma = (0, database_1.getPrismaClient)();
        // Delete existing reminders for this task to avoid duplicates
        await (0, database_1.executeWithRetry)(async () => {
            return await prisma.reminder.deleteMany({
                where: {
                    targetType: 'TASK',
                    targetId: taskId,
                    userId,
                },
            });
        });
        // Delete existing alarms for this task to avoid duplicates
        await (0, database_1.executeWithRetry)(async () => {
            return await prisma.alarm.deleteMany({
                where: {
                    userId,
                    linkedTaskId: taskId,
                },
            });
        }).catch(err => {
            logger_1.logger.warn(`Failed to delete existing alarms for task ${taskId}, continuing anyway:`, err);
        });
        const now = new Date();
        const dueDateTime = new Date(dueDate);
        // If dueTime is provided, combine it with dueDate
        if (dueTime) {
            const [hours, minutes] = dueTime.split(':').map(Number);
            dueDateTime.setHours(hours, minutes, 0, 0);
            logger_1.logger.info('Combined due date with time', { dueDateTime: dueDateTime.toISOString(), hours, minutes });
        }
        else {
            // If no time specified, use end of day (23:59)
            dueDateTime.setHours(23, 59, 0, 0);
            logger_1.logger.info('No due time specified, using end of day', { dueDateTime: dueDateTime.toISOString() });
        }
        // Only schedule if due date is in the future
        if (dueDateTime <= now) {
            logger_1.logger.warn(`Task ${taskId} due date is in the past, skipping notification scheduling`, {
                dueDateTime: dueDateTime.toISOString(),
                now: now.toISOString()
            });
            return;
        }
        // Calculate reminder times
        const oneDayBefore = new Date(dueDateTime);
        oneDayBefore.setDate(oneDayBefore.getDate() - 1);
        const oneHourBefore = new Date(dueDateTime);
        oneHourBefore.setHours(oneHourBefore.getHours() - 1);
        // Schedule reminders
        const reminders = [];
        // 1 day before (if more than 1 hour away and in the future)
        if (oneDayBefore > now && oneDayBefore < dueDateTime) {
            try {
                const reminder1 = await (0, database_1.executeWithRetry)(async () => {
                    return await prisma.reminder.create({
                        data: {
                            userId,
                            targetType: 'TASK',
                            targetId: taskId,
                            title: `Task Due Tomorrow: ${taskTitle}`,
                            note: `Your task "${taskTitle}" is due tomorrow.`,
                            triggerType: 'TIME',
                            schedule: {
                                at: oneDayBefore.toISOString(),
                            },
                        },
                    });
                });
                reminders.push({ reminder: reminder1, time: oneDayBefore, type: 'DUE_DATE_REMINDER' });
                logger_1.logger.info(`Created 1-day-before reminder for task ${taskId} at ${oneDayBefore.toISOString()}`);
            }
            catch (error) {
                logger_1.logger.error(`Failed to create 1-day-before reminder for task ${taskId}:`, error);
            }
        }
        // 1 hour before (if more than now and in the future)
        if (oneHourBefore > now && oneHourBefore < dueDateTime) {
            try {
                const reminder2 = await (0, database_1.executeWithRetry)(async () => {
                    return await prisma.reminder.create({
                        data: {
                            userId,
                            targetType: 'TASK',
                            targetId: taskId,
                            title: `Task Due in 1 Hour: ${taskTitle}`,
                            note: `Your task "${taskTitle}" is due in 1 hour.`,
                            triggerType: 'TIME',
                            schedule: {
                                at: oneHourBefore.toISOString(),
                            },
                        },
                    });
                });
                reminders.push({ reminder: reminder2, time: oneHourBefore, type: 'DUE_DATE_REMINDER' });
                logger_1.logger.info(`Created 1-hour-before reminder for task ${taskId} at ${oneHourBefore.toISOString()}`);
            }
            catch (error) {
                logger_1.logger.error(`Failed to create 1-hour-before reminder for task ${taskId}:`, error);
            }
        }
        // Always schedule "at due time" reminder if due date is in the future
        try {
            const reminder3 = await (0, database_1.executeWithRetry)(async () => {
                return await prisma.reminder.create({
                    data: {
                        userId,
                        targetType: 'TASK',
                        targetId: taskId,
                        title: `Task Due: ${taskTitle}`,
                        note: `Your task "${taskTitle}" is due now.`,
                        triggerType: 'TIME',
                        schedule: {
                            at: dueDateTime.toISOString(),
                        },
                    },
                });
            });
            reminders.push({ reminder: reminder3, time: dueDateTime, type: 'DUE_DATE_REMINDER' });
            logger_1.logger.info(`Created due-time reminder for task ${taskId} at ${dueDateTime.toISOString()}`);
            // Also create an alarm record so it can be scheduled as a native alarm on the device
            try {
                // Delete existing alarms for this task to avoid duplicates
                await (0, database_1.executeWithRetry)(async () => {
                    return await prisma.alarm.deleteMany({
                        where: {
                            userId,
                            linkedTaskId: taskId,
                        },
                    });
                });
                // Get user timezone (default to UTC if not available)
                const user = await (0, database_1.executeWithRetry)(async () => {
                    return await prisma.user.findUnique({
                        where: { id: userId },
                        select: { timezone: true },
                    });
                }).catch(() => null);
                const userTimezone = user?.timezone || 'UTC';
                // Create alarm record for native alarm scheduling
                await (0, database_1.executeWithRetry)(async () => {
                    return await prisma.alarm.create({
                        data: {
                            userId,
                            title: `Task Due: ${taskTitle}`,
                            time: dueDateTime,
                            timezone: userTimezone,
                            linkedTaskId: taskId,
                            enabled: true,
                            recurrenceRule: null, // Tasks are typically one-time
                        },
                    });
                });
                logger_1.logger.info(`Created alarm record for task ${taskId} at ${dueDateTime.toISOString()}`);
            }
            catch (alarmError) {
                logger_1.logger.error(`Failed to create alarm record for task ${taskId}:`, alarmError);
                // Don't fail the whole operation if alarm creation fails
            }
        }
        catch (error) {
            logger_1.logger.error(`Failed to create due-time reminder for task ${taskId}:`, error);
        }
        // Schedule all reminders
        logger_1.logger.info(`Scheduling ${reminders.length} reminders for task ${taskId}`);
        for (const { reminder, time, type } of reminders) {
            try {
                await (0, queue_service_1.scheduleReminder)(reminder.id, userId, time, type);
                logger_1.logger.info(`Successfully scheduled task reminder for ${taskId} at ${time.toISOString()}, type: ${type}`);
            }
            catch (error) {
                logger_1.logger.error(`Failed to schedule reminder for task ${taskId}:`, error);
                // Clean up reminder if scheduling failed
                await (0, database_1.executeWithRetry)(async () => {
                    return await prisma.reminder.delete({ where: { id: reminder.id } });
                }).catch(() => { });
            }
        }
        if (reminders.length === 0) {
            logger_1.logger.warn(`No reminders scheduled for task ${taskId} - all reminder times are in the past`);
        }
    }
    catch (error) {
        logger_1.logger.error(`Failed to schedule task due date notifications for ${taskId}:`, error);
        // Don't throw - this shouldn't break task creation
    }
}
/**
 * Schedule notifications for milestone due dates
 */
async function scheduleMilestoneDueDateNotifications(milestoneId, goalId, userId, dueDate, milestoneTitle) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        // Delete existing reminders for this milestone
        // Since targetId is null for GOAL type, match by note content
        await (0, database_1.executeWithRetry)(async () => {
            return await prisma.reminder.deleteMany({
                where: {
                    targetType: 'GOAL',
                    userId,
                    note: {
                        contains: milestoneTitle,
                    },
                },
            });
        });
        const now = new Date();
        const dueDateTime = new Date(dueDate);
        // Set to end of day (23:59) if no specific time is provided
        // This ensures notifications are sent at the end of the milestone due date
        dueDateTime.setHours(23, 59, 0, 0);
        // Only schedule if due date is in the future
        if (dueDateTime <= now) {
            logger_1.logger.info(`Milestone ${milestoneId} due date is in the past, skipping notification scheduling`);
            return;
        }
        // Calculate reminder times
        const oneDayBefore = new Date(dueDateTime);
        oneDayBefore.setDate(oneDayBefore.getDate() - 1);
        const oneHourBefore = new Date(dueDateTime);
        oneHourBefore.setHours(oneHourBefore.getHours() - 1);
        const reminders = [];
        // 1 day before
        if (oneDayBefore > now && oneDayBefore < dueDateTime) {
            try {
                const reminder1 = await (0, database_1.executeWithRetry)(async () => {
                    return await prisma.reminder.create({
                        data: {
                            userId,
                            targetType: 'GOAL',
                            targetId: null, // Set to null - foreign key constraint only applies to TASK type
                            title: `Milestone Due Tomorrow: ${milestoneTitle}`,
                            note: `Your milestone "${milestoneTitle}" is due tomorrow.`,
                            triggerType: 'TIME',
                            schedule: {
                                at: oneDayBefore.toISOString(),
                                milestoneId: milestoneId, // Store IDs in schedule for reference
                                goalId: goalId,
                            },
                        },
                    });
                });
                reminders.push({ reminder: reminder1, time: oneDayBefore, type: 'GOAL_REMINDER' });
            }
            catch (error) {
                logger_1.logger.error(`Failed to create 1-day-before reminder for milestone ${milestoneId}:`, error);
            }
        }
        // 1 hour before
        if (oneHourBefore > now && oneHourBefore < dueDateTime) {
            try {
                const reminder2 = await (0, database_1.executeWithRetry)(async () => {
                    return await prisma.reminder.create({
                        data: {
                            userId,
                            targetType: 'GOAL',
                            targetId: null, // Set to null - foreign key constraint only applies to TASK type
                            title: `Milestone Due in 1 Hour: ${milestoneTitle}`,
                            note: `Your milestone "${milestoneTitle}" is due in 1 hour.`,
                            triggerType: 'TIME',
                            schedule: {
                                at: oneHourBefore.toISOString(),
                                milestoneId: milestoneId, // Store IDs in schedule for reference
                                goalId: goalId,
                            },
                        },
                    });
                });
                reminders.push({ reminder: reminder2, time: oneHourBefore, type: 'GOAL_REMINDER' });
            }
            catch (error) {
                logger_1.logger.error(`Failed to create 1-hour-before reminder for milestone ${milestoneId}:`, error);
            }
        }
        // At due time
        try {
            const reminder3 = await (0, database_1.executeWithRetry)(async () => {
                return await prisma.reminder.create({
                    data: {
                        userId,
                        targetType: 'GOAL',
                        targetId: null, // Set to null - foreign key constraint only applies to TASK type
                        title: `Milestone Due Now: ${milestoneTitle}`,
                        note: `Your milestone "${milestoneTitle}" is due now.`,
                        triggerType: 'TIME',
                        schedule: {
                            at: dueDateTime.toISOString(),
                            milestoneId: milestoneId, // Store IDs in schedule for reference
                            goalId: goalId,
                        },
                    },
                });
            });
            reminders.push({ reminder: reminder3, time: dueDateTime, type: 'GOAL_REMINDER' });
        }
        catch (error) {
            logger_1.logger.error(`Failed to create due-time reminder for milestone ${milestoneId}:`, error);
        }
        // Schedule all reminders
        for (const { reminder, time, type } of reminders) {
            try {
                await (0, queue_service_1.scheduleReminder)(reminder.id, userId, time, type);
                logger_1.logger.info(`Scheduled milestone reminder for ${milestoneId} at ${time.toISOString()}`);
            }
            catch (error) {
                logger_1.logger.error(`Failed to schedule reminder for milestone ${milestoneId}:`, error);
                await (0, database_1.executeWithRetry)(async () => {
                    return await prisma.reminder.delete({ where: { id: reminder.id } });
                }).catch(() => { });
            }
        }
    }
    catch (error) {
        logger_1.logger.error(`Failed to schedule milestone due date notifications for ${milestoneId}:`, error);
    }
}
/**
 * Check for overdue milestones and send notifications
 * This should be called periodically (e.g., daily cron job)
 */
async function checkAndNotifyOverdueMilestones() {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        const now = new Date();
        // Find all overdue milestones that are not completed
        const overdueMilestones = await (0, database_1.executeWithRetry)(async () => {
            return await prisma.milestone.findMany({
                where: {
                    dueDate: {
                        lt: now,
                    },
                    status: {
                        not: 'DONE',
                    },
                    goal: {
                        status: {
                            not: 'DONE',
                        },
                    },
                },
                include: {
                    goal: {
                        select: {
                            id: true,
                            userId: true,
                            title: true,
                        },
                    },
                },
            });
        });
        logger_1.logger.info(`Found ${overdueMilestones.length} overdue milestones`);
        for (const milestone of overdueMilestones) {
            const goal = milestone.goal;
            if (!goal) {
                logger_1.logger.warn(`Milestone ${milestone.id} has no associated goal, skipping`);
                continue;
            }
            const userId = goal.userId;
            const goalId = goal.id;
            // Check if we've already sent an overdue notification for this milestone today
            const todayStart = new Date(now);
            todayStart.setHours(0, 0, 0, 0);
            const existingReminder = await (0, database_1.executeWithRetry)(async () => {
                return await prisma.reminder.findFirst({
                    where: {
                        userId,
                        targetType: 'GOAL',
                        title: {
                            contains: `Overdue Milestone: ${milestone.title}`,
                        },
                        createdAt: {
                            gte: todayStart,
                        },
                    },
                });
            });
            if (existingReminder) {
                logger_1.logger.info(`Overdue notification already sent today for milestone ${milestone.id}`);
                continue;
            }
            // Calculate days overdue
            const daysOverdue = Math.floor((now.getTime() - milestone.dueDate.getTime()) / (1000 * 60 * 60 * 24));
            // Create reminder for overdue milestone
            const reminder = await (0, database_1.executeWithRetry)(async () => {
                return await prisma.reminder.create({
                    data: {
                        userId,
                        targetType: 'GOAL',
                        targetId: null,
                        title: `Overdue Milestone: ${milestone.title}`,
                        note: `Your milestone "${milestone.title}" for goal "${goal.title}" is ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue.`,
                        triggerType: 'TIME',
                        schedule: {
                            at: now.toISOString(),
                            milestoneId: milestone.id,
                            goalId: goalId,
                        },
                    },
                });
            });
            // Send notification immediately (for overdue milestones, we don't schedule in the past)
            try {
                // Schedule for 1 second in the future to avoid "Cannot schedule reminder in the past" error
                const immediateTime = new Date(Date.now() + 1000);
                await (0, queue_service_1.scheduleReminder)(reminder.id, userId, immediateTime, 'GOAL_REMINDER');
                logger_1.logger.info(`Scheduled overdue notification for milestone ${milestone.id} (immediate)`);
            }
            catch (error) {
                logger_1.logger.error(`Failed to schedule overdue reminder for milestone ${milestone.id}:`, error);
                await (0, database_1.executeWithRetry)(async () => {
                    return await prisma.reminder.delete({ where: { id: reminder.id } });
                }).catch(() => { });
            }
        }
    }
    catch (error) {
        logger_1.logger.error('Failed to check and notify overdue milestones:', error);
    }
}
/**
 * Schedule notifications for goal target dates
 */
async function scheduleGoalTargetDateNotifications(goalId, userId, targetDate, goalTitle) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        // Delete existing reminders for this goal
        // Since targetId is null for GOAL type (due to FK constraint), we need to match by schedule.goalId
        await (0, database_1.executeWithRetry)(async () => {
            return await prisma.reminder.deleteMany({
                where: {
                    targetType: 'GOAL',
                    userId,
                    note: {
                        contains: goalTitle,
                    },
                },
            });
        });
        const now = new Date();
        const targetDateTime = new Date(targetDate);
        // Only schedule if target date is in the future
        if (targetDateTime <= now) {
            logger_1.logger.info(`Goal ${goalId} target date is in the past, skipping notification scheduling`);
            return;
        }
        // Calculate reminder times
        const oneWeekBefore = new Date(targetDateTime);
        oneWeekBefore.setDate(oneWeekBefore.getDate() - 7);
        const oneDayBefore = new Date(targetDateTime);
        oneDayBefore.setDate(oneDayBefore.getDate() - 1);
        const reminders = [];
        // 1 week before
        if (oneWeekBefore > now && oneWeekBefore < targetDateTime) {
            try {
                const reminder1 = await (0, database_1.executeWithRetry)(async () => {
                    return await prisma.reminder.create({
                        data: {
                            userId,
                            targetType: 'GOAL',
                            targetId: null, // Set to null - foreign key constraint only applies to TASK type
                            title: `Goal Deadline in 1 Week: ${goalTitle}`,
                            note: `Your goal "${goalTitle}" deadline is in 1 week.`,
                            triggerType: 'TIME',
                            schedule: {
                                at: oneWeekBefore.toISOString(),
                                goalId: goalId, // Store goalId in schedule for reference
                            },
                        },
                    });
                });
                reminders.push({ reminder: reminder1, time: oneWeekBefore, type: 'GOAL_REMINDER' });
            }
            catch (error) {
                logger_1.logger.error(`Failed to create 1-week-before reminder for goal ${goalId}:`, error);
            }
        }
        // 1 day before
        if (oneDayBefore > now && oneDayBefore < targetDateTime) {
            try {
                const reminder2 = await (0, database_1.executeWithRetry)(async () => {
                    return await prisma.reminder.create({
                        data: {
                            userId,
                            targetType: 'GOAL',
                            targetId: null, // Set to null - foreign key constraint only applies to TASK type
                            title: `Goal Deadline Tomorrow: ${goalTitle}`,
                            note: `Your goal "${goalTitle}" deadline is tomorrow.`,
                            triggerType: 'TIME',
                            schedule: {
                                at: oneDayBefore.toISOString(),
                                goalId: goalId, // Store goalId in schedule for reference
                            },
                        },
                    });
                });
                reminders.push({ reminder: reminder2, time: oneDayBefore, type: 'GOAL_REMINDER' });
            }
            catch (error) {
                logger_1.logger.error(`Failed to create 1-day-before reminder for goal ${goalId}:`, error);
            }
        }
        // At target date
        try {
            const reminder3 = await (0, database_1.executeWithRetry)(async () => {
                return await prisma.reminder.create({
                    data: {
                        userId,
                        targetType: 'GOAL',
                        targetId: null, // Set to null - foreign key constraint only applies to TASK type
                        title: `Goal Deadline Today: ${goalTitle}`,
                        note: `Your goal "${goalTitle}" deadline is today.`,
                        triggerType: 'TIME',
                        schedule: {
                            at: targetDateTime.toISOString(),
                            goalId: goalId, // Store goalId in schedule for reference
                        },
                    },
                });
            });
            reminders.push({ reminder: reminder3, time: targetDateTime, type: 'GOAL_REMINDER' });
        }
        catch (error) {
            logger_1.logger.error(`Failed to create due-time reminder for goal ${goalId}:`, error);
        }
        // Schedule all reminders
        for (const { reminder, time, type } of reminders) {
            try {
                await (0, queue_service_1.scheduleReminder)(reminder.id, userId, time, type);
                logger_1.logger.info(`Scheduled goal reminder for ${goalId} at ${time.toISOString()}`);
            }
            catch (error) {
                logger_1.logger.error(`Failed to schedule reminder for goal ${goalId}:`, error);
                await (0, database_1.executeWithRetry)(async () => {
                    return await prisma.reminder.delete({ where: { id: reminder.id } });
                }).catch(() => { });
            }
        }
    }
    catch (error) {
        logger_1.logger.error(`Failed to schedule goal target date notifications for ${goalId}:`, error);
    }
}
/**
 * Cancel all scheduled notifications for an alarm.
 */
async function cancelAlarmPushNotifications(alarmId, userId) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        // Get all notifications for this alarm
        const notifications = await (0, database_1.executeWithRetry)(async () => {
            return await prisma.notification.findMany({
                where: {
                    userId,
                    payload: {
                        path: ['alarmId'],
                        equals: alarmId,
                    },
                },
            });
        });
        // Cancel jobs in the queue
        const { getQueue } = await Promise.resolve().then(() => __importStar(require('./queue.service')));
        const notificationQueue = getQueue('NOTIFICATIONS');
        if (!notificationQueue) {
            logger_1.logger.warn('Notification queue not available, skipping job cancellation');
            // Return early to satisfy TypeScript type narrowing
            return;
        }
        // TypeScript now knows notificationQueue is defined
        for (const notification of notifications) {
            try {
                // Find and remove jobs for this notification
                const jobs = await notificationQueue.getJobs(['waiting', 'delayed', 'active']);
                for (const job of jobs) {
                    if (job.data.notificationId === notification.id) {
                        await job.remove();
                        logger_1.logger.info(`Removed notification job for notification ${notification.id}`);
                    }
                }
            }
            catch (jobError) {
                logger_1.logger.warn(`Failed to remove job for notification ${notification.id}:`, jobError);
            }
        }
        // Delete notification records
        const deleted = await (0, database_1.executeWithRetry)(async () => {
            return await prisma.notification.deleteMany({
                where: {
                    userId,
                    payload: {
                        path: ['alarmId'],
                        equals: alarmId,
                    },
                },
            });
        });
        logger_1.logger.info(`Cancelled ${deleted.count} scheduled notifications for alarm ${alarmId}`);
    }
    catch (error) {
        logger_1.logger.warn(`Failed to cancel scheduled notifications for alarm ${alarmId}:`, error);
    }
}
/**
 * Cancel ALL pending alarm notifications for a user.
 * This is useful for cleaning up stale notifications.
 */
async function cancelAllPendingAlarmNotifications(userId) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        // Get all pending alarm notifications for this user
        const notifications = await (0, database_1.executeWithRetry)(async () => {
            return await prisma.notification.findMany({
                where: {
                    userId,
                    status: 'PENDING',
                    payload: {
                        path: ['notificationType'],
                        equals: ALARM_NOTIFICATION_TYPE,
                    },
                },
            });
        });
        logger_1.logger.info(`Found ${notifications.length} pending alarm notifications for user ${userId}`);
        // Cancel jobs in the queue
        const { getQueue } = await Promise.resolve().then(() => __importStar(require('./queue.service')));
        const notificationQueue = getQueue('NOTIFICATIONS');
        let cancelledJobs = 0;
        if (!notificationQueue) {
            logger_1.logger.warn('Notification queue not available, skipping job cancellation');
            // Return early to satisfy TypeScript type narrowing
            return cancelledJobs;
        }
        // TypeScript now knows notificationQueue is defined
        for (const notification of notifications) {
            try {
                // Find and remove jobs for this notification
                const jobs = await notificationQueue.getJobs(['waiting', 'delayed', 'active']);
                for (const job of jobs) {
                    if (job.data.notificationId === notification.id) {
                        await job.remove();
                        cancelledJobs++;
                        logger_1.logger.info(`Removed notification job for notification ${notification.id}`);
                    }
                }
            }
            catch (jobError) {
                logger_1.logger.warn(`Failed to remove job for notification ${notification.id}:`, jobError);
            }
        }
        // Delete notification records
        const deleted = await (0, database_1.executeWithRetry)(async () => {
            return await prisma.notification.deleteMany({
                where: {
                    userId,
                    status: 'PENDING',
                    payload: {
                        path: ['notificationType'],
                        equals: ALARM_NOTIFICATION_TYPE,
                    },
                },
            });
        });
        logger_1.logger.info(`Cancelled ${deleted.count} pending alarm notifications for user ${userId}`);
        return deleted.count;
    }
    catch (error) {
        logger_1.logger.error(`Failed to cancel all pending alarm notifications for user ${userId}:`, error);
        throw error;
    }
}
/**
 * Schedule a push notification to fire at the alarm time.
 * Skips scheduling if the alarm is disabled or the time is in the past.
 */
async function scheduleAlarmPushNotification(alarm) {
    const now = new Date();
    const alarmTime = new Date(alarm.time);
    if (!alarm.enabled) {
        logger_1.logger.info(`Alarm ${alarm.id} is disabled, skipping push notification scheduling`);
        await cancelAlarmPushNotifications(alarm.id, alarm.userId);
        return;
    }
    if (Number.isNaN(alarmTime.getTime())) {
        logger_1.logger.warn(`Invalid alarm time provided for alarm ${alarm.id}, skipping scheduling`);
        await cancelAlarmPushNotifications(alarm.id, alarm.userId);
        return;
    }
    // For recurring alarms, calculate the next valid occurrence if the current time is in the past
    let scheduledAlarmTime = alarmTime;
    if (alarm.recurrenceRule && alarmTime.getTime() <= now.getTime()) {
        // Calculate next occurrence based on recurrence rule
        if (alarm.recurrenceRule.startsWith('FREQ=DAILY')) {
            // For daily alarms, add 1 day if time has passed
            scheduledAlarmTime = new Date(alarmTime);
            while (scheduledAlarmTime.getTime() <= now.getTime()) {
                scheduledAlarmTime.setDate(scheduledAlarmTime.getDate() + 1);
            }
            logger_1.logger.info(`Alarm ${alarm.id} time is in the past, scheduling for next occurrence: ${scheduledAlarmTime.toISOString()}`);
        }
        else if (alarm.recurrenceRule.startsWith('FREQ=WEEKLY')) {
            // For weekly alarms, add 1 week if time has passed
            scheduledAlarmTime = new Date(alarmTime);
            while (scheduledAlarmTime.getTime() <= now.getTime()) {
                scheduledAlarmTime.setDate(scheduledAlarmTime.getDate() + 7);
            }
            logger_1.logger.info(`Alarm ${alarm.id} time is in the past, scheduling for next occurrence: ${scheduledAlarmTime.toISOString()}`);
        }
        else if (alarm.recurrenceRule.startsWith('FREQ=MONTHLY')) {
            // For monthly alarms, add 1 month if time has passed
            scheduledAlarmTime = new Date(alarmTime);
            while (scheduledAlarmTime.getTime() <= now.getTime()) {
                scheduledAlarmTime.setMonth(scheduledAlarmTime.getMonth() + 1);
            }
            logger_1.logger.info(`Alarm ${alarm.id} time is in the past, scheduling for next occurrence: ${scheduledAlarmTime.toISOString()}`);
        }
        else {
            // For other recurrence rules or non-recurring alarms, only skip if more than 1 second in the past
            if (alarmTime.getTime() < now.getTime() - 1000) {
                logger_1.logger.warn(`Alarm ${alarm.id} time is too far in the past (${alarmTime.toISOString()}), skipping scheduling`);
                await cancelAlarmPushNotifications(alarm.id, alarm.userId);
                return;
            }
        }
    }
    // Only skip if alarm is more than 1 second in the past (allow very soon alarms)
    // Changed from 5 seconds buffer to 1 second to allow alarms even if they're very soon
    if (scheduledAlarmTime.getTime() < now.getTime() - 1000) {
        logger_1.logger.warn(`Alarm ${alarm.id} time is too far in the past (${scheduledAlarmTime.toISOString()}), skipping scheduling`);
        await cancelAlarmPushNotifications(alarm.id, alarm.userId);
        return;
    }
    const prisma = (0, database_1.getPrismaClient)();
    // Remove existing scheduled notifications for this alarm before creating new ones
    await cancelAlarmPushNotifications(alarm.id, alarm.userId);
    const title = `Alarm: ${alarm.title}`;
    const alarmTimeStr = scheduledAlarmTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const body = `It's time for "${alarm.title}" at ${alarmTimeStr}.`;
    try {
        const notification = await (0, database_1.executeWithRetry)(async () => {
            return await prisma.notification.create({
                data: {
                    userId: alarm.userId,
                    type: 'IN_APP',
                    payload: {
                        title,
                        body,
                        alarmId: alarm.id,
                        notificationType: ALARM_NOTIFICATION_TYPE,
                        alarmTime: scheduledAlarmTime.toISOString(), // Add alarm time for debugging
                    },
                    scheduledFor: scheduledAlarmTime,
                    status: 'PENDING',
                },
            });
        });
        await (0, queue_service_2.scheduleNotification)(notification.id, alarm.userId, scheduledAlarmTime, ALARM_NOTIFICATION_TYPE, {
            title,
            body,
            alarmId: alarm.id,
            notificationType: ALARM_NOTIFICATION_TYPE,
            alarmTime: scheduledAlarmTime.toISOString(), // Add alarm time for debugging
        });
        logger_1.logger.info(`Scheduled push notification for alarm ${alarm.id} at ${scheduledAlarmTime.toISOString()}`);
    }
    catch (error) {
        logger_1.logger.error(`Failed to schedule push notification for alarm ${alarm.id}:`, error);
        // Clean up notification record if scheduling failed
        try {
            await (0, database_1.executeWithRetry)(async () => {
                return await prisma.notification.deleteMany({
                    where: {
                        userId: alarm.userId,
                        payload: {
                            path: ['alarmId'],
                            equals: alarm.id,
                        },
                    },
                });
            });
        }
        catch (cleanupError) {
            logger_1.logger.warn(`Failed to clean up notification record for alarm ${alarm.id}:`, cleanupError);
        }
    }
}
/**
 * Send notification when task is assigned to a user
 */
async function sendTaskAssignmentNotification(taskId, assigneeId, taskTitle, assignerName) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        // Create notification record
        const notification = await (0, database_1.executeWithRetry)(async () => {
            return await prisma.notification.create({
                data: {
                    userId: assigneeId,
                    type: 'IN_APP',
                    payload: {
                        taskId,
                        title: taskTitle,
                        assignerName: assignerName || 'Someone',
                        notificationType: 'TASK_ASSIGNMENT',
                    },
                    scheduledFor: new Date(), // Send immediately
                    status: 'PENDING',
                },
            });
        });
        // Schedule immediate notification
        await (0, queue_service_2.scheduleNotification)(notification.id, assigneeId, getImmediateScheduleTime(), 'TASK_ASSIGNMENT', {
            title: `New Task Assigned: ${taskTitle}`,
            body: assignerName
                ? `${assignerName} assigned you a task: ${taskTitle}`
                : `You have been assigned a new task: ${taskTitle}`,
        });
        logger_1.logger.info(`Sent task assignment notification for task ${taskId} to user ${assigneeId}`);
    }
    catch (error) {
        logger_1.logger.error(`Failed to send task assignment notification for ${taskId}:`, error);
    }
}
/**
 * Send notification when a task is created.
 * Primarily used for testing push notification flow.
 */
async function sendTaskCreatedNotification(taskId, userId, taskTitle, context) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        const notification = await (0, database_1.executeWithRetry)(async () => {
            return await prisma.notification.create({
                data: {
                    userId,
                    type: 'IN_APP',
                    payload: {
                        taskId,
                        title: `Task Created: ${taskTitle}`,
                        body: context?.projectTitle
                            ? `You created "${taskTitle}" in project ${context.projectTitle}.`
                            : `You created a new task: "${taskTitle}".`,
                        notificationType: 'TASK_CREATED',
                    },
                    scheduledFor: new Date(),
                    status: 'PENDING',
                },
            });
        });
        await (0, queue_service_2.scheduleNotification)(notification.id, userId, getImmediateScheduleTime(), 'TASK_CREATED', {
            title: `Task Created: ${taskTitle}`,
            body: context?.projectTitle
                ? `Task "${taskTitle}" was created in ${context.projectTitle}.`
                : `Task "${taskTitle}" was created successfully.`,
        });
        logger_1.logger.info(`Sent task created notification for task ${taskId} to user ${userId}`);
    }
    catch (error) {
        logger_1.logger.error(`Failed to send task created notification for ${taskId}:`, error);
    }
}
/**
 * Schedule push notifications for routine tasks
 * Creates recurring reminders based on routine frequency and task reminderTime
 */
async function scheduleRoutineTaskNotifications(routineId, userId, routineTitle, frequency, schedule, timezone, taskId, taskTitle, reminderTime, reminderBefore) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        const now = new Date();
        // Cancel existing reminders for this routine task
        // Since targetId is null for CUSTOM type (due to FK constraint), match by note content
        await (0, database_1.executeWithRetry)(async () => {
            return await prisma.reminder.deleteMany({
                where: {
                    targetType: 'CUSTOM',
                    userId,
                    note: {
                        contains: taskTitle,
                    },
                },
            });
        });
        // Skip if routine doesn't have a time set
        if (!schedule.time) {
            logger_1.logger.info(`Routine ${routineId} has no time set, skipping notification scheduling`);
            return;
        }
        // Calculate notification time based on routine schedule and task reminderTime
        const [routineHours, routineMinutes] = schedule.time.split(':').map(Number);
        // Calculate adjusted notification time based on reminderTime
        // reminderTime can be:
        // - Absolute time: "05:00" (use this time directly)
        // - Relative offset: "-15min", "-1hour", "-30min" (subtract from routine time)
        let notificationHours = routineHours;
        let notificationMinutes = routineMinutes;
        if (reminderTime) {
            if (reminderTime.startsWith('-')) {
                // Relative offset: subtract from routine time
                const offsetStr = reminderTime.slice(1).toLowerCase();
                if (offsetStr.includes('min')) {
                    const mins = parseInt(offsetStr.replace('min', '').replace('s', ''), 10);
                    const totalMinutes = routineHours * 60 + routineMinutes - mins;
                    notificationHours = Math.floor(totalMinutes / 60);
                    notificationMinutes = totalMinutes % 60;
                    // Handle negative hours (previous day)
                    if (notificationHours < 0) {
                        notificationHours += 24;
                    }
                }
                else if (offsetStr.includes('hour')) {
                    const hours = parseInt(offsetStr.replace('hour', '').replace('s', ''), 10);
                    notificationHours = routineHours - hours;
                    // Handle negative hours (previous day)
                    if (notificationHours < 0) {
                        notificationHours += 24;
                    }
                }
            }
            else if (reminderTime.includes(':')) {
                // Absolute time - use reminderTime directly
                const [reminderHours, reminderMinutes] = reminderTime.split(':').map(Number);
                notificationHours = reminderHours;
                notificationMinutes = reminderMinutes;
            }
        }
        // Format notification time as HH:mm
        const notificationTimeStr = `${String(notificationHours).padStart(2, '0')}:${String(notificationMinutes).padStart(2, '0')}`;
        // Calculate next occurrence based on frequency
        // Use the notification time for calculations
        let nextOccurrence = null;
        if (frequency === 'DAILY') {
            nextOccurrence = new Date(now);
            nextOccurrence.setHours(notificationHours, notificationMinutes, 0, 0);
            if (nextOccurrence <= now) {
                nextOccurrence.setDate(nextOccurrence.getDate() + 1);
            }
        }
        else if (frequency === 'WEEKLY' && schedule.days && schedule.days.length > 0) {
            // Find soonest upcoming day
            const currentDay = now.getDay();
            let soonest = null;
            for (const day of schedule.days) {
                const d = new Date(now);
                const delta = (day - currentDay + 7) % 7;
                d.setDate(d.getDate() + delta);
                d.setHours(notificationHours, notificationMinutes, 0, 0);
                if (d <= now) {
                    d.setDate(d.getDate() + 7);
                }
                if (!soonest || d < soonest)
                    soonest = d;
            }
            nextOccurrence = soonest;
        }
        else if (frequency === 'MONTHLY' && schedule.day) {
            nextOccurrence = new Date(now);
            nextOccurrence.setDate(schedule.day);
            nextOccurrence.setHours(notificationHours, notificationMinutes, 0, 0);
            if (nextOccurrence <= now) {
                nextOccurrence.setMonth(nextOccurrence.getMonth() + 1);
            }
        }
        else if (frequency === 'YEARLY') {
            // For yearly, we'd need more complex logic - skip for now
            logger_1.logger.warn(`Yearly frequency not fully supported for routine notifications, skipping ${routineId}`);
            return;
        }
        if (!nextOccurrence || nextOccurrence <= now) {
            logger_1.logger.warn(`Could not calculate valid next occurrence for routine task ${taskId}, skipping notification`);
            return;
        }
        // Create reminder schedule matching routine frequency
        // Use the notification time (adjusted by reminderTime) for the schedule
        // IMPORTANT: Store timezone in schedule for correct rescheduling
        const reminderSchedule = {
            frequency,
            time: notificationTimeStr,
            timezone: timezone || 'UTC', // Store routine timezone for rescheduling
        };
        if (frequency === 'WEEKLY' && schedule.days) {
            reminderSchedule.days = schedule.days;
        }
        else if (frequency === 'MONTHLY' && schedule.day) {
            reminderSchedule.day = schedule.day;
        }
        logger_1.logger.info(`Creating reminder for routine task ${taskId}`, {
            reminderSchedule,
            nextOccurrence: nextOccurrence.toISOString(),
            routineId,
            taskId,
        });
        // Store reminder schedule for later use (needed for alarm creation)
        const fullReminderSchedule = {
            ...reminderSchedule,
            routineId: routineId, // Store IDs in schedule for reference
            taskId: taskId,
        };
        // Create reminder record
        const reminder = await (0, database_1.executeWithRetry)(async () => {
            return await prisma.reminder.create({
                data: {
                    userId,
                    targetType: 'CUSTOM',
                    targetId: null, // Set to null - foreign key constraint only applies to TASK type
                    title: `Routine: ${routineTitle}`,
                    note: `Time to complete "${taskTitle}"`,
                    triggerType: 'TIME',
                    schedule: fullReminderSchedule,
                },
            });
        });
        // Schedule the first reminder
        try {
            const delay = nextOccurrence.getTime() - Date.now();
            if (delay <= 0) {
                logger_1.logger.warn(`Cannot schedule routine task notification in the past for task ${taskId}`, {
                    taskId,
                    routineId,
                    nextOccurrence: nextOccurrence.toISOString(),
                    now: new Date().toISOString(),
                    delay,
                });
                return;
            }
            const job = await (0, queue_service_1.scheduleReminder)(reminder.id, userId, nextOccurrence, 'ROUTINE_REMINDER');
            logger_1.logger.info(`Scheduled routine task notification for task ${taskId}`, {
                reminderId: reminder.id,
                taskId,
                routineId,
                taskTitle,
                nextOccurrence: nextOccurrence.toISOString(),
                schedule: reminderSchedule,
                frequency,
                jobId: job.id,
                delay,
                delayMinutes: Math.round(delay / 60000),
            });
            // Always create an alarm for the routine task
            // Priority: reminderBefore > reminderTime > routine schedule time
            try {
                let alarmTimeForReminder;
                // If reminderBefore is set, calculate alarm time as routine time - reminderBefore
                if (reminderBefore) {
                    // Parse reminderBefore (e.g., "1h", "2d", "1w")
                    const match = reminderBefore.match(/^(\d+)([hdw])$/);
                    if (match) {
                        const [, valueStr, unit] = match;
                        const value = parseInt(valueStr, 10);
                        const [routineHours, routineMinutes] = (schedule.time || '00:00').split(':').map(Number);
                        let alarmHours = routineHours;
                        let alarmMinutes = routineMinutes;
                        if (unit === 'h') {
                            // Hours before - subtract hours from routine time
                            alarmHours = routineHours - value;
                            // Handle negative hours (wraps to previous day)
                            while (alarmHours < 0) {
                                alarmHours += 24; // Wrap to previous day
                            }
                            // Also handle hours >= 24 (shouldn't happen but safety check)
                            alarmHours = alarmHours % 24;
                        }
                        else if (unit === 'd') {
                            // Days before - keep same time, will be handled by date calculation in alarm creation
                            // For now, use routine time but the date will be adjusted
                            alarmHours = routineHours;
                            alarmMinutes = routineMinutes;
                        }
                        else if (unit === 'w') {
                            // Weeks before - keep same time, will be handled by date calculation
                            alarmHours = routineHours;
                            alarmMinutes = routineMinutes;
                        }
                        // Format as HH:mm
                        alarmTimeForReminder = `${String(alarmHours).padStart(2, '0')}:${String(alarmMinutes).padStart(2, '0')}`;
                        logger_1.logger.info(`Calculated alarm time from reminderBefore: routine ${schedule.time}, reminderBefore ${reminderBefore}, value=${value}, unit=${unit}, routineHours=${routineHours}, alarmHours=${alarmHours}, alarm time ${alarmTimeForReminder}`);
                    }
                    else {
                        // Invalid reminderBefore format, fall back to reminderTime or routine time
                        alarmTimeForReminder = reminderTime || schedule.time || '00:00';
                    }
                }
                else {
                    // No reminderBefore, use reminderTime if provided, otherwise use routine schedule time
                    alarmTimeForReminder = reminderTime || schedule.time || '00:00';
                }
                await createAlarmForRoutineReminder(routineId, taskId, userId, routineTitle, taskTitle, nextOccurrence, frequency, schedule, timezone, alarmTimeForReminder, fullReminderSchedule, reminderBefore // Pass reminderBefore for date adjustments if needed
                );
            }
            catch (alarmError) {
                logger_1.logger.error(`Failed to create alarm for routine task reminder ${taskId}:`, {
                    error: alarmError,
                    taskId,
                    routineId,
                    reminderTime: reminderTime || 'routine time',
                    reminderBefore,
                });
                // Don't throw - alarm creation failure shouldn't break reminder scheduling
            }
        }
        catch (scheduleError) {
            logger_1.logger.error(`Failed to schedule reminder job for routine task ${taskId}:`, {
                error: scheduleError,
                reminderId: reminder.id,
                taskId,
                routineId,
                nextOccurrence: nextOccurrence.toISOString(),
                schedule: reminderSchedule,
            });
            // Don't throw - log the error but continue
        }
    }
    catch (error) {
        logger_1.logger.error(`Failed to schedule routine task notifications for task ${taskId}:`, {
            error,
            taskId,
            routineId,
            userId,
        });
    }
}
/**
 * Cancel all notifications for a routine task
 */
async function cancelRoutineTaskNotifications(taskId, userId) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        // Since targetId is null for CUSTOM type, we need to match by schedule.taskId
        const allCustomReminders = await (0, database_1.executeWithRetry)(async () => {
            return await prisma.reminder.findMany({
                where: {
                    targetType: 'CUSTOM',
                    userId,
                },
            });
        });
        // Filter reminders where schedule.taskId matches
        const matchingReminders = allCustomReminders.filter((reminder) => {
            const schedule = reminder.schedule;
            return schedule?.taskId === taskId;
        });
        // Delete matching reminders
        for (const reminder of matchingReminders) {
            await (0, database_1.executeWithRetry)(async () => {
                return await prisma.reminder.delete({
                    where: { id: reminder.id },
                });
            });
        }
        logger_1.logger.info(`Cancelled ${matchingReminders.length} reminders for routine task ${taskId}`);
    }
    catch (error) {
        logger_1.logger.warn(`Failed to cancel reminders for routine task ${taskId}:`, error);
    }
}
/**
 * Cancel all notifications for all tasks in a routine
 */
async function cancelRoutineNotifications(routineId, userId) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        // Get all tasks for this routine
        const routine = await (0, database_1.executeWithRetry)(async () => {
            return await prisma.routine.findUnique({
                where: { id: routineId },
                include: { routineTasks: true },
            });
        });
        if (!routine) {
            return;
        }
        // Cancel alarms for this routine
        await (0, database_1.executeWithRetry)(async () => {
            return await prisma.alarm.deleteMany({
                where: {
                    userId,
                    title: {
                        contains: `Routine: ${routine.title}`,
                    },
                },
            });
        });
        // Cancel notifications for each task
        for (const task of routine.routineTasks) {
            await cancelRoutineTaskNotifications(task.id, userId);
        }
        logger_1.logger.info(`Cancelled all notifications for routine ${routineId}`);
    }
    catch (error) {
        logger_1.logger.warn(`Failed to cancel notifications for routine ${routineId}:`, error);
    }
}
/**
 * Schedule notifications for all tasks in a routine
 */
/**
 * Schedule routine reminder notification based on reminderBefore field
 * This creates a reminder before the routine occurs (e.g., 2 hours before, 1 day before)
 */
async function scheduleRoutineReminderNotification(routineId, userId, routineTitle, frequency, schedule, timezone, reminderBefore, // e.g., "2h", "1d", "1w"
nextOccurrence) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        const now = new Date();
        // Parse reminderBefore (e.g., "2h", "1d", "1w")
        const match = reminderBefore.match(/^(\d+)([hdw])$/);
        if (!match) {
            logger_1.logger.warn(`Invalid reminderBefore format: ${reminderBefore}, skipping reminder notification`);
            return;
        }
        const [, valueStr, unit] = match;
        const value = parseInt(valueStr, 10);
        // Calculate reminder time by subtracting from next occurrence
        const reminderTime = new Date(nextOccurrence);
        if (unit === 'h') {
            // Hours before
            reminderTime.setHours(reminderTime.getHours() - value);
        }
        else if (unit === 'd') {
            // Days before
            reminderTime.setDate(reminderTime.getDate() - value);
        }
        else if (unit === 'w') {
            // Weeks before
            reminderTime.setDate(reminderTime.getDate() - (value * 7));
        }
        // Only schedule if reminder time is in the future
        // For routines created at or near the routine time, the reminder might be in the past
        // In that case, we should schedule for the next occurrence's reminder time
        if (reminderTime <= now) {
            logger_1.logger.info(`Routine reminder time is in the past: ${reminderTime.toISOString()}, calculating next reminder time`);
            // Recalculate reminder time based on the next routine occurrence
            // For DAILY: add 1 day to reminder time
            // For WEEKLY: add 7 days
            // For MONTHLY: add 1 month
            if (frequency === 'DAILY') {
                reminderTime.setDate(reminderTime.getDate() + 1);
            }
            else if (frequency === 'WEEKLY' && schedule.days && schedule.days.length > 0) {
                reminderTime.setDate(reminderTime.getDate() + 7);
            }
            else if (frequency === 'MONTHLY' && schedule.day) {
                reminderTime.setMonth(reminderTime.getMonth() + 1);
            }
            else {
                // Default: add 1 day
                reminderTime.setDate(reminderTime.getDate() + 1);
            }
            logger_1.logger.info(`Recalculated reminder time to: ${reminderTime.toISOString()}`);
            // Double-check it's in the future now
            if (reminderTime <= now) {
                logger_1.logger.error(`Recalculated reminder time is still in the past, skipping: ${reminderTime.toISOString()}, now: ${now.toISOString()}`);
                return;
            }
        }
        else {
            logger_1.logger.info(`Reminder time is in the future: ${reminderTime.toISOString()}, scheduling normally`);
        }
        // Cancel existing routine reminder notifications
        await (0, database_1.executeWithRetry)(async () => {
            return await prisma.reminder.deleteMany({
                where: {
                    targetType: 'CUSTOM',
                    userId,
                    title: {
                        contains: `Routine Reminder: ${routineTitle}`,
                    },
                },
            });
        });
        // Create reminder schedule
        const reminderSchedule = {
            frequency,
            time: schedule.time,
            timezone: timezone || 'UTC',
            routineId,
            reminderBefore,
        };
        if (frequency === 'WEEKLY' && schedule.days) {
            reminderSchedule.days = schedule.days;
        }
        else if (frequency === 'MONTHLY' && schedule.day) {
            reminderSchedule.day = schedule.day;
        }
        // Create reminder record
        const reminder = await (0, database_1.executeWithRetry)(async () => {
            return await prisma.reminder.create({
                data: {
                    userId,
                    targetType: 'CUSTOM',
                    targetId: null,
                    title: `Routine Reminder: ${routineTitle}`,
                    note: `Your routine "${routineTitle}" is coming up soon`,
                    triggerType: 'TIME',
                    schedule: reminderSchedule,
                },
            });
        });
        // Schedule the reminder notification
        const delay = reminderTime.getTime() - Date.now();
        if (delay <= 0) {
            logger_1.logger.warn(`Cannot schedule routine reminder in the past for routine ${routineId}`, {
                reminderTime: reminderTime.toISOString(),
                now: new Date().toISOString(),
                delay,
            });
            return;
        }
        const job = await (0, queue_service_1.scheduleReminder)(reminder.id, userId, reminderTime, 'ROUTINE_REMINDER');
        logger_1.logger.info(`✅ Scheduled routine reminder notification for routine ${routineId}`, {
            reminderId: reminder.id,
            routineId,
            reminderTime: reminderTime.toISOString(),
            reminderTimeLocal: `${reminderTime.getHours()}:${String(reminderTime.getMinutes()).padStart(2, '0')}`,
            nextOccurrence: nextOccurrence.toISOString(),
            nextOccurrenceLocal: `${nextOccurrence.getHours()}:${String(nextOccurrence.getMinutes()).padStart(2, '0')}`,
            reminderBefore,
            jobId: job.id,
            delayMs: delay,
            delayMinutes: Math.round(delay / 60000),
            delayHours: Math.round(delay / 3600000 * 10) / 10,
        });
    }
    catch (error) {
        logger_1.logger.error(`Failed to schedule routine reminder notification for routine ${routineId}:`, error);
    }
}
async function scheduleRoutineNotifications(routineId, _userId) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        // Retry logic for connection errors
        let routine;
        let retries = 0;
        const maxRetries = 3;
        while (retries < maxRetries) {
            try {
                routine = await prisma.routine.findUnique({
                    where: { id: routineId },
                    include: { routineTasks: true },
                });
                break; // Success, exit retry loop
            }
            catch (error) {
                const isConnectionError = error?.code === 'P1017' ||
                    error?.message?.includes('connection') ||
                    error?.message?.includes('closed');
                if (isConnectionError && retries < maxRetries - 1) {
                    retries++;
                    logger_1.logger.warn(`Database connection error when fetching routine (attempt ${retries}/${maxRetries}), retrying...`, {
                        routineId,
                        error: error.message,
                    });
                    await new Promise(resolve => setTimeout(resolve, 1000 * retries));
                    continue;
                }
                throw error; // Re-throw if not connection error or max retries reached
            }
        }
        if (!routine || !routine.enabled) {
            logger_1.logger.info(`Routine ${routineId} not found or disabled, skipping notification scheduling`);
            return;
        }
        const schedule = routine.schedule;
        // Calculate next occurrence for the routine
        const now = new Date();
        let nextOccurrence = null;
        const [routineHours, routineMinutes] = (schedule.time || '00:00').split(':').map(Number);
        if (routine.frequency === 'DAILY') {
            nextOccurrence = new Date(now);
            nextOccurrence.setHours(routineHours, routineMinutes, 0, 0);
            // Use a small buffer (1 second) to avoid edge cases when creating at exact routine time
            // If routine time is in the past or exactly now, schedule for tomorrow
            if (nextOccurrence.getTime() <= now.getTime() + 1000) {
                nextOccurrence.setDate(nextOccurrence.getDate() + 1);
            }
            logger_1.logger.info(`Calculated nextOccurrence for DAILY routine: ${nextOccurrence.toISOString()}, now: ${now.toISOString()}`);
        }
        else if (routine.frequency === 'WEEKLY' && schedule.days && schedule.days.length > 0) {
            const currentDay = now.getDay();
            let soonest = null;
            for (const day of schedule.days) {
                const d = new Date(now);
                const delta = (day - currentDay + 7) % 7;
                d.setDate(d.getDate() + delta);
                d.setHours(routineHours, routineMinutes, 0, 0);
                if (d <= now) {
                    d.setDate(d.getDate() + 7);
                }
                if (!soonest || d < soonest)
                    soonest = d;
            }
            nextOccurrence = soonest;
        }
        else if (routine.frequency === 'MONTHLY' && schedule.day) {
            nextOccurrence = new Date(now);
            nextOccurrence.setDate(schedule.day);
            nextOccurrence.setHours(routineHours, routineMinutes, 0, 0);
            if (nextOccurrence <= now) {
                nextOccurrence.setMonth(nextOccurrence.getMonth() + 1);
            }
        }
        // Schedule routine reminder if reminderBefore is set
        if (routine.reminderBefore && nextOccurrence) {
            logger_1.logger.info(`Scheduling routine reminder for routine ${routine.id}`, {
                routineId: routine.id,
                routineTitle: routine.title,
                reminderBefore: routine.reminderBefore,
                nextOccurrence: nextOccurrence.toISOString(),
                frequency: routine.frequency,
            });
            await scheduleRoutineReminderNotification(routine.id, routine.userId, routine.title, routine.frequency, schedule, routine.timezone, routine.reminderBefore, nextOccurrence).catch(err => {
                logger_1.logger.error(`Failed to schedule routine reminder notification:`, err);
                // Don't throw - continue with task notifications
            });
        }
        else {
            logger_1.logger.info(`No reminderBefore set for routine ${routine.id} (reminderBefore: ${routine.reminderBefore}, nextOccurrence: ${nextOccurrence?.toISOString()})`);
        }
        // Schedule notifications for each task
        for (const task of routine.routineTasks) {
            await scheduleRoutineTaskNotifications(routine.id, routine.userId, routine.title, routine.frequency, schedule, routine.timezone, task.id, task.title, task.reminderTime, routine.reminderBefore // Pass reminderBefore so alarm can be created at reminder time
            );
        }
        logger_1.logger.info(`Scheduled notifications for all tasks in routine ${routineId}`);
    }
    catch (error) {
        logger_1.logger.error(`Failed to schedule notifications for routine ${routineId}:`, error);
    }
}
/**
 * Create an alarm for a routine reminder time
 * This creates a recurring alarm that matches the routine frequency
 */
async function createAlarmForRoutineReminder(routineId, taskId, userId, routineTitle, taskTitle, nextOccurrence, frequency, schedule, timezone, reminderTime, reminderSchedule, reminderBefore) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        // Cancel existing alarms for this routine task
        try {
            await (0, database_1.executeWithRetry)(async () => {
                return await prisma.alarm.deleteMany({
                    where: {
                        userId,
                        title: {
                            contains: `Routine: ${routineTitle}`,
                        },
                    },
                });
            });
        }
        catch (deleteError) {
            logger_1.logger.warn(`Failed to delete existing alarms for routine, continuing anyway:`, {
                error: deleteError,
                routineId,
                routineTitle,
            });
            // Continue - we'll try to create the alarm anyway
        }
        // Calculate alarm time based on nextOccurrence and reminderBefore/reminderTime
        // Start with nextOccurrence as the base
        const alarmTime = new Date(nextOccurrence);
        // If reminderTime is provided as a time string (e.g., "03:01"), use it first
        // This means reminderBefore was already applied in scheduleRoutineTaskNotifications
        if (reminderTime && reminderTime.includes(':')) {
            const [reminderH, reminderM] = reminderTime.split(':').map(Number);
            const [routineH, routineM] = (schedule.time || '00:00').split(':').map(Number);
            // Set the alarm time to the reminder time
            // For reminderBefore='1d' or '1w', we need to subtract days from nextOccurrence
            // For reminderBefore='1h', we just use the reminder time on the same day as nextOccurrence
            alarmTime.setHours(reminderH, reminderM, 0, 0);
            // If reminderBefore is set and is days or weeks, adjust the date
            if (reminderBefore) {
                const match = reminderBefore.match(/^(\d+)([hdw])$/);
                if (match) {
                    const [, valueStr, unit] = match;
                    const value = parseInt(valueStr, 10);
                    if (unit === 'd') {
                        // Days before - subtract days from nextOccurrence's date
                        alarmTime.setDate(alarmTime.getDate() - value);
                    }
                    else if (unit === 'w') {
                        // Weeks before - subtract weeks from nextOccurrence's date
                        alarmTime.setDate(alarmTime.getDate() - (value * 7));
                    }
                    // For 'h' (hours), the time is already calculated correctly, just use nextOccurrence's date
                }
            }
            logger_1.logger.info(`Using provided reminderTime: ${reminderTime}, reminderBefore: ${reminderBefore}, nextOccurrence: ${nextOccurrence.toISOString()}, alarm time set to: ${alarmTime.toISOString()}`);
        }
        else if (reminderBefore) {
            // If reminderBefore is set but no reminderTime, calculate from nextOccurrence
            const match = reminderBefore.match(/^(\d+)([hdw])$/);
            if (match) {
                const [, valueStr, unit] = match;
                const value = parseInt(valueStr, 10);
                if (unit === 'h') {
                    // Hours before - subtract hours from nextOccurrence
                    alarmTime.setHours(alarmTime.getHours() - value);
                }
                else if (unit === 'd') {
                    // Days before - subtract days from nextOccurrence
                    alarmTime.setDate(alarmTime.getDate() - value);
                }
                else if (unit === 'w') {
                    // Weeks before - subtract weeks from nextOccurrence
                    alarmTime.setDate(alarmTime.getDate() - (value * 7));
                }
                logger_1.logger.info(`Using reminderBefore to calculate: ${reminderBefore}, alarm time: ${alarmTime.toISOString()}`);
            }
        }
        // If neither reminderTime nor reminderBefore is set, alarmTime = nextOccurrence (routine time)
        // If neither reminderBefore nor reminderTime is set, alarmTime = nextOccurrence (routine time)
        // Ensure alarm time is not in the past - calculate next occurrence if needed
        const now = new Date();
        if (alarmTime <= now) {
            // If alarm time is in the past, we need to recalculate based on the next routine occurrence
            // The alarm should be scheduled for the next occurrence of the routine, minus the reminderBefore time
            logger_1.logger.warn(`Alarm time is in the past: ${alarmTime.toISOString()}, recalculating from nextOccurrence`);
            // Start fresh from nextOccurrence
            alarmTime.setTime(nextOccurrence.getTime());
            // Re-apply reminderBefore to get the correct alarm time for the next occurrence
            if (reminderBefore) {
                const match = reminderBefore.match(/^(\d+)([hdw])$/);
                if (match) {
                    const [, valueStr, unit] = match;
                    const value = parseInt(valueStr, 10);
                    if (unit === 'h') {
                        alarmTime.setHours(alarmTime.getHours() - value);
                    }
                    else if (unit === 'd') {
                        alarmTime.setDate(alarmTime.getDate() - value);
                    }
                    else if (unit === 'w') {
                        alarmTime.setDate(alarmTime.getDate() - (value * 7));
                    }
                }
            }
            else if (reminderTime && reminderTime.includes(':')) {
                // Re-apply reminderTime for next occurrence
                const [reminderH, reminderM] = reminderTime.split(':').map(Number);
                const [routineH, routineM] = (schedule.time || '00:00').split(':').map(Number);
                alarmTime.setHours(reminderH, reminderM, 0, 0);
                if (reminderH < routineH || (reminderH === routineH && reminderM < routineM)) {
                    alarmTime.setDate(alarmTime.getDate() - 1);
                }
            }
            // Double-check: if still in the past, add one more cycle
            // This handles cases where reminderBefore pushes the alarm time into the past
            if (alarmTime <= now) {
                logger_1.logger.warn(`Alarm time still in the past after recalculation: ${alarmTime.toISOString()}, adding one cycle`);
                // First, move alarmTime forward by one cycle based on frequency
                if (frequency === 'DAILY') {
                    alarmTime.setDate(alarmTime.getDate() + 1);
                }
                else if (frequency === 'WEEKLY' && schedule.days && schedule.days.length > 0) {
                    alarmTime.setDate(alarmTime.getDate() + 7);
                }
                else if (frequency === 'MONTHLY' && schedule.day) {
                    alarmTime.setMonth(alarmTime.getMonth() + 1);
                }
                else {
                    // Default: add 1 day
                    alarmTime.setDate(alarmTime.getDate() + 1);
                }
                // Then re-apply reminderBefore to get the correct reminder time for the next cycle
                if (reminderBefore) {
                    const match = reminderBefore.match(/^(\d+)([hdw])$/);
                    if (match) {
                        const [, valueStr, unit] = match;
                        const value = parseInt(valueStr, 10);
                        if (unit === 'h') {
                            alarmTime.setHours(alarmTime.getHours() - value);
                        }
                        else if (unit === 'd') {
                            alarmTime.setDate(alarmTime.getDate() - value);
                        }
                        else if (unit === 'w') {
                            alarmTime.setDate(alarmTime.getDate() - (value * 7));
                        }
                    }
                }
                logger_1.logger.info(`After adding cycle and re-applying reminderBefore: ${alarmTime.toISOString()}`);
            }
            logger_1.logger.info(`Adjusted alarm time to next occurrence: ${alarmTime.toISOString()}`);
        }
        logger_1.logger.info(`Final alarm time calculation: reminderBefore=${reminderBefore}, reminderTime=${reminderTime}, nextOccurrence=${nextOccurrence.toISOString()}, alarmTime=${alarmTime.toISOString()}, alarmTimeLocal=${alarmTime.getHours()}:${String(alarmTime.getMinutes()).padStart(2, '0')}, now=${now.toISOString()}`);
        // Final check: ensure alarm time is in the future
        if (alarmTime <= now) {
            logger_1.logger.error(`❌ CRITICAL: Alarm time is still in the past after all calculations! alarmTime=${alarmTime.toISOString()}, now=${now.toISOString()}`);
            // Don't create the alarm if it's in the past
            return;
        }
        // If alarm time is before nextOccurrence (for hours offset), it means we need to adjust the date
        // For absolute times, we want the alarm at that time on the same day as nextOccurrence
        // For relative times, the calculation above should be correct
        // Generate recurrence rule based on frequency
        let recurrenceRule = null;
        if (frequency === 'DAILY') {
            recurrenceRule = 'FREQ=DAILY';
        }
        else if (frequency === 'WEEKLY' && schedule.days && schedule.days.length > 0) {
            // Convert days to RRULE format (0=Sunday, 1=Monday, etc.)
            // RRULE uses: SU,MO,TU,WE,TH,FR,SA
            const dayNames = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
            const byDay = schedule.days.map(day => dayNames[day]).join(',');
            recurrenceRule = `FREQ=WEEKLY;BYDAY=${byDay}`;
        }
        else if (frequency === 'MONTHLY' && schedule.day) {
            recurrenceRule = `FREQ=MONTHLY;BYMONTHDAY=${schedule.day}`;
        }
        else if (frequency === 'YEARLY') {
            // For yearly, we'd need the full date - simplified for now
            recurrenceRule = 'FREQ=YEARLY';
        }
        // Create the alarm with error handling for database connection issues
        let alarm;
        try {
            alarm = await (0, database_1.executeWithRetry)(async () => {
                return await prisma.alarm.create({
                    data: {
                        userId,
                        title: `Routine: ${routineTitle}`,
                        time: alarmTime,
                        timezone: timezone || 'UTC',
                        recurrenceRule,
                        enabled: true,
                        snoozeConfig: {
                            duration: 5, // 5 minutes snooze
                            maxSnoozes: 3,
                        },
                        smartWakeWindow: 5,
                    },
                });
            });
            logger_1.logger.info(`Alarm created successfully in database`, {
                alarmId: alarm.id,
                routineId,
                taskId,
                alarmTime: alarmTime.toISOString(),
                alarmTimeLocal: `${alarmTime.getHours()}:${String(alarmTime.getMinutes()).padStart(2, '0')}`,
                reminderBefore,
                reminderTime,
                scheduleTime: schedule.time,
            });
        }
        catch (createError) {
            logger_1.logger.error(`Failed to create alarm in database:`, {
                error: createError,
                routineId,
                taskId,
                alarmTime: alarmTime.toISOString(),
                errorMessage: createError?.message,
                errorCode: createError?.code,
            });
            throw createError; // Re-throw to be caught by outer try-catch
        }
        // NOTE: Backend push notifications are DISABLED for routine alarms
        // Native Android AlarmManager handles all alarm ringing via AlarmPlayerService
        // The frontend schedules native alarms via ReliableAlarmService when alarms are loaded
        // Backend push notifications are only used for task/routine REMINDERS (not alarms)
        // This prevents double-ringing and ensures consistent behavior
        logger_1.logger.debug('Routine alarm created - native alarms will handle ringing', { alarmId: alarm.id });
        // Cancel any existing backend push notifications for this alarm (cleanup)
        try {
            await cancelAlarmPushNotifications(alarm.id, userId);
        }
        catch (cancelError) {
            logger_1.logger.warn(`Failed to cancel existing backend push notifications for routine alarm:`, {
                error: cancelError,
                alarmId: alarm.id,
            });
            // Don't throw - alarm creation succeeded, notification scheduling can be retried
        }
        // Store alarm ID in reminder schedule for reference
        // Use try-catch to handle potential database connection issues
        try {
            await (0, database_1.executeWithRetry)(async () => {
                return await prisma.reminder.updateMany({
                    where: {
                        userId,
                        targetType: 'CUSTOM',
                        note: {
                            contains: taskTitle,
                        },
                    },
                    data: {
                        schedule: {
                            ...reminderSchedule,
                            alarmId: alarm.id,
                        },
                    },
                });
            });
        }
        catch (updateError) {
            logger_1.logger.warn(`Failed to update reminder with alarm ID, but alarm was created successfully`, {
                error: updateError,
                alarmId: alarm.id,
                reminderId: reminderSchedule.taskId,
            });
            // Don't throw - alarm creation succeeded, reminder update is optional
        }
        logger_1.logger.info(`Created alarm for routine task reminder`, {
            alarmId: alarm.id,
            routineId,
            taskId,
            alarmTime: alarmTime.toISOString(),
            recurrenceRule,
            reminderTime,
        });
    }
    catch (error) {
        logger_1.logger.error(`Failed to create alarm for routine reminder:`, error);
        throw error;
    }
}
