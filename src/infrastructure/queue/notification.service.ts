import { getPrismaClient } from '../../shared/utils/database';
import { logger } from '../../shared/utils/logger';

export interface CreateInvitationNotificationData {
  userId: string;
  invitationId: string;
  projectName: string;
  inviterName: string;
  role: string;
}

export interface InvitationNotificationResponse {
  id: string;
  type: string;
  payload: any;
  createdAt: Date;
  isRead: boolean;
}

class NotificationService {
  async createInvitationNotification(data: CreateInvitationNotificationData): Promise<void> {
    try {
      const prisma = getPrismaClient();
      
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

      logger.info('Created invitation notification', { notificationId: notification.id });
    } catch (error) {
      logger.error('Failed to create invitation notification:', error);
      throw error;
    }
  }

  async getUserNotifications(userId: string): Promise<InvitationNotificationResponse[]> {
    try {
      const prisma = getPrismaClient();
      
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
        payload: notification.payload as any,
        createdAt: notification.createdAt,
        isRead: notification.status === 'SENT'
      }));
    } catch (error) {
      logger.error('Failed to get user notifications:', error);
      throw error;
    }
  }

  async markNotificationAsRead(notificationId: string): Promise<void> {
    try {
      const prisma = getPrismaClient();
      
      await prisma.notification.update({
        where: { id: notificationId },
        data: { status: 'SENT' }
      });

      logger.info('Marked notification as read', { notificationId });
    } catch (error) {
      logger.error('Failed to mark notification as read:', error);
      throw error;
    }
  }

  async getUnreadNotificationCount(userId: string): Promise<number> {
    try {
      const prisma = getPrismaClient();
      
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
    } catch (error) {
      logger.error('Failed to get unread notification count:', error);
      throw error;
    }
  }

  async deleteNotification(notificationId: string): Promise<void> {
    try {
      const prisma = getPrismaClient();
      
      await prisma.notification.delete({
        where: { id: notificationId }
      });

      logger.info('Deleted notification', { notificationId });
    } catch (error) {
      logger.error('Failed to delete notification:', error);
      throw error;
    }
  }
}

export const notificationService = new NotificationService();
