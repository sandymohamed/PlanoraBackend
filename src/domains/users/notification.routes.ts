import { Router, Response } from 'express';
import { notificationService } from '../../infrastructure/queue/notification.service';
import { AuthenticatedRequest } from '../../shared/types';
import { authenticateToken } from '../../shared/middleware/auth';
import { logger } from '../../shared/utils/logger';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

// GET /api/v1/notifications - Get user notifications
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const notifications = await notificationService.getUserNotifications(userId);

    res.json({
      success: true,
      data: notifications,
    });
  } catch (error: any) {
    logger.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get notifications',
      error: error.message,
    });
  }
});

// GET /api/v1/notifications/unread-count - Get unread notification count
router.get('/unread-count', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const count = await notificationService.getUnreadNotificationCount(userId);

    res.json({
      success: true,
      data: { count },
    });
  } catch (error: any) {
    logger.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread count',
      error: error.message,
    });
  }
});

// PUT /api/v1/notifications/:id/read - Mark notification as read
router.put('/:id/read', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    await notificationService.markNotificationAsRead(id);

    res.json({
      success: true,
      message: 'Notification marked as read',
    });
  } catch (error: any) {
    logger.error('Mark notification as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read',
      error: error.message,
    });
  }
});

// DELETE /api/v1/notifications/:id - Delete notification
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    await notificationService.deleteNotification(id);

    res.json({
      success: true,
      message: 'Notification deleted',
    });
  } catch (error: any) {
    logger.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification',
      error: error.message,
    });
  }
});

export default router;
