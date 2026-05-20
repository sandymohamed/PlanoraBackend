"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationService = void 0;
const database_1 = require("../../shared/utils/database");
const logger_1 = require("../../shared/utils/logger");
class NotificationService {
    async createInvitationNotification(data) {
        try {
            const prisma = (0, database_1.getPrismaClient)();
            const notification = await prisma.notification.create({
                data: {
                    userId: data.userId,
                    type: 'IN_APP',
                    payload: {
                        invitationId: data.invitationId,
                        projectName: data.projectName,
                        inviterName: data.inviterName,
                        role: data.role,
                        notificationType: 'PROJECT_INVITATION'
                    },
                    scheduledFor: new Date(), // Send immediately
                    status: 'PENDING'
                }
            });
            logger_1.logger.info('Created invitation notification', { notificationId: notification.id });
        }
        catch (error) {
            logger_1.logger.error('Failed to create invitation notification:', error);
            throw error;
        }
    }
    async getUserNotifications(userId) {
        try {
            const prisma = (0, database_1.getPrismaClient)();
            const notifications = await prisma.notification.findMany({
                where: {
                    userId,
                    type: 'IN_APP',
                    payload: {
                        path: ['notificationType'],
                        equals: 'PROJECT_INVITATION'
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                },
                take: 50 // Limit to recent notifications
            });
            return notifications.map(notification => ({
                id: notification.id,
                type: notification.type,
                payload: notification.payload,
                createdAt: notification.createdAt,
                isRead: notification.status === 'SENT'
            }));
        }
        catch (error) {
            logger_1.logger.error('Failed to get user notifications:', error);
            throw error;
        }
    }
    async markNotificationAsRead(notificationId) {
        try {
            const prisma = (0, database_1.getPrismaClient)();
            await prisma.notification.update({
                where: { id: notificationId },
                data: { status: 'SENT' }
            });
            logger_1.logger.info('Marked notification as read', { notificationId });
        }
        catch (error) {
            logger_1.logger.error('Failed to mark notification as read:', error);
            throw error;
        }
    }
    async getUnreadNotificationCount(userId) {
        try {
            const prisma = (0, database_1.getPrismaClient)();
            const count = await prisma.notification.count({
                where: {
                    userId,
                    type: 'IN_APP',
                    status: 'PENDING',
                    payload: {
                        path: ['notificationType'],
                        equals: 'PROJECT_INVITATION'
                    }
                }
            });
            return count;
        }
        catch (error) {
            logger_1.logger.error('Failed to get unread notification count:', error);
            throw error;
        }
    }
    async deleteNotification(notificationId) {
        try {
            const prisma = (0, database_1.getPrismaClient)();
            await prisma.notification.delete({
                where: { id: notificationId }
            });
            logger_1.logger.info('Deleted notification', { notificationId });
        }
        catch (error) {
            logger_1.logger.error('Failed to delete notification:', error);
            throw error;
        }
    }
}
exports.notificationService = new NotificationService();
