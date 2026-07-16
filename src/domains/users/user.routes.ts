import { Router, Response } from 'express';
import Joi from 'joi';
import bcrypt from 'bcryptjs';
import { getPrismaClient } from '../../shared/utils/database';
import { authenticateToken } from '../../shared/middleware/auth';
import { AuthenticatedRequest, ValidationError } from '../../shared/types';
import { logger } from '../../shared/utils/logger';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

const updateProfileSchema = Joi.object({
  name: Joi.string().min(2).max(100).optional(),
  timezone: Joi.string().optional(),
  settings: Joi.object().optional(),
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(8).required(),
});

const notificationSettingsSchema = Joi.object({
  pushNotifications: Joi.boolean().optional(),
  emailNotifications: Joi.boolean().optional(),
  taskReminders: Joi.boolean().optional(),
  goalReminders: Joi.boolean().optional(),
  projectInvitations: Joi.boolean().optional(),
  taskAssignments: Joi.boolean().optional(),
  taskComments: Joi.boolean().optional(),
  dueDateReminders: Joi.boolean().optional(),
  weeklyDigest: Joi.boolean().optional(),
  monthlyReport: Joi.boolean().optional(),
  marketingEmails: Joi.boolean().optional(),
}).unknown(false); // Reject unknown fields to prevent accidental field inclusion

const privacySettingsSchema = Joi.object({
  shareAnalytics: Joi.boolean().optional(),
  shareCrashReports: Joi.boolean().optional(),
  showProfileToOthers: Joi.boolean().optional(),
  allowProjectInvites: Joi.boolean().optional(),
  showActivityStatus: Joi.boolean().optional(),
  allowDataCollection: Joi.boolean().optional(),
});

const pushTokenSchema = Joi.object({
  token: Joi.string().required(),
  platform: Joi.string().valid('android', 'ios').required(),
});

// GET /api/v1/me
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    
    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    throw error;
  }
});

// PUT /api/v1/me
router.put('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error, value } = updateProfileSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const prisma = getPrismaClient();
    const userId = req.user!.id;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: value,
      select: {
        id: true,
        email: true,
        name: true,
        timezone: true,
        settings: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({
      success: true,
      data: updatedUser,
      message: 'Profile updated successfully',
    });
  } catch (error) {
    throw error;
  }
});

// // DELETE /api/v1/me
// router.delete('/', async (req: AuthenticatedRequest, res: Response) => {
//   try {
//     const prisma = getPrismaClient();
//     const userId = req.user!.id;

//     // Delete user and all related data (cascade)
//     await prisma.user.delete({
//       where: { id: userId },
//     });

//     res.json({
//       success: true,
//       message: 'Account deleted successfully',
//     });
//   } catch (error) {
//     throw error;
//   }
// });

// GET /api/v1/me/stats
router.get('/stats', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const prisma = getPrismaClient();
    const userId = req.user!.id;

    const [
      taskCount,
      completedTasks,
      goalCount,
      completedGoals,
      projectCount,
      alarmCount,
      reminderCount,
    ] = await Promise.all([
      prisma.task.count({
        where: { creatorId: userId },
      }),
      prisma.task.count({
        where: { 
          creatorId: userId,
          status: 'DONE',
        },
      }),
      prisma.goal.count({
        where: { userId },
      }),
      prisma.goal.count({
        where: { 
          userId,
          // Assuming we add a status field to goals
        },
      }),
      prisma.project.count({
        where: { ownerId: userId },
      }),
      prisma.alarm.count({
        where: { userId },
      }),
      prisma.reminder.count({
        where: { userId },
      }),
    ]);

    res.json({
      success: true,
      data: {
        tasks: {
          total: taskCount,
          completed: completedTasks,
          completionRate: taskCount > 0 ? (completedTasks / taskCount) * 100 : 0,
        },
        goals: {
          total: goalCount,
          completed: completedGoals,
        },
        projects: projectCount,
        alarms: alarmCount,
        reminders: reminderCount,
      },
    });
  } catch (error) {
    throw error;
  }
});

// POST /api/v1/me/change-password
router.post('/change-password', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error, value } = changePasswordSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const prisma = getPrismaClient();
    const userId = req.user!.id;
    const { currentPassword, newPassword } = value;

    // Get user with password
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        error: 'Current password is incorrect',
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hashedPassword },
    });

    return res.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    throw error;
  }
});

// POST /api/v1/me/push-token - Register push notification token (must come before /notification-settings to avoid route conflicts)
router.post('/push-token', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error, value } = pushTokenSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { token, platform } = value;

    const prisma = getPrismaClient();
    const userId = req.user!.id;

    // Get current user settings
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });

    const currentSettings = (user?.settings as any) || {};
    const pushTokens = currentSettings.pushTokens || [];

    // Remove existing token if it exists (same token or same platform)
    const filteredTokens = pushTokens.filter(
      (t: any) => t.token !== token && t.platform !== platform
    );

    // Add new token
    const newToken = {
      token,
      platform,
      registeredAt: new Date().toISOString(),
    };

    const updatedSettings = {
      ...currentSettings,
      pushTokens: [...filteredTokens, newToken],
    };

    await prisma.user.update({
      where: { id: userId },
      data: { settings: updatedSettings },
    });

    logger.info(`Push token registered for user ${userId}`, { platform, tokenLength: token.length });

    res.json({
      success: true,
      data: newToken,
      message: 'Push token registered successfully',
    });
  } catch (error) {
    throw error;
  }
});

// DELETE /api/v1/me/push-token - Remove push notification token
router.delete('/push-token', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const deletePushTokenSchema = Joi.object({
      token: Joi.string().required(),
    });

    const { error, value } = deletePushTokenSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { token } = value;

    const prisma = getPrismaClient();
    const userId = req.user!.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });

    const currentSettings = (user?.settings as any) || {};
    const pushTokens = (currentSettings.pushTokens || []).filter(
      (t: any) => t.token !== token
    );

    const updatedSettings = {
      ...currentSettings,
      pushTokens,
    };

    await prisma.user.update({
      where: { id: userId },
      data: { settings: updatedSettings },
    });

    res.json({
      success: true,
      message: 'Push token removed successfully',
    });
  } catch (error) {
    throw error;
  }
});

// GET /api/v1/me/notification-settings
router.get('/notification-settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const prisma = getPrismaClient();
    const userId = req.user!.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });

    const settings = (user?.settings as any) || {};
    const notificationSettings = settings.notifications || {
      pushNotifications: true,
      emailNotifications: false,
      taskReminders: true,
      goalReminders: true,
      projectInvitations: true,
      taskAssignments: true,
      taskComments: true,
      dueDateReminders: true,
      weeklyDigest: false,
      monthlyReport: false,
      marketingEmails: false,
    };

    res.json({
      success: true,
      data: notificationSettings,
    });
  } catch (error) {
    throw error;
  }
});

// PUT /api/v1/me/notification-settings
router.put('/notification-settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error, value } = notificationSettingsSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const prisma = getPrismaClient();
    const userId = req.user!.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });

    const currentSettings = (user?.settings as any) || {};
    const updatedSettings = {
      ...currentSettings,
      notifications: {
        ...(currentSettings.notifications || {}),
        ...value,
      },
    };

    await prisma.user.update({
      where: { id: userId },
      data: { settings: updatedSettings },
    });

    res.json({
      success: true,
      data: updatedSettings.notifications,
      message: 'Notification settings updated successfully',
    });
  } catch (error) {
    throw error;
  }
});


// GET /api/v1/me/privacy-settings
router.get('/privacy-settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const prisma = getPrismaClient();
    const userId = req.user!.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });

    const settings = (user?.settings as any) || {};
    const privacySettings = settings.privacy || {
      shareAnalytics: true,
      shareCrashReports: true,
      showProfileToOthers: true,
      allowProjectInvites: true,
      showActivityStatus: true,
      allowDataCollection: true,
    };

    res.json({
      success: true,
      data: privacySettings,
    });
  } catch (error) {
    throw error;
  }
});

// PUT /api/v1/me/privacy-settings
router.put('/privacy-settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error, value } = privacySettingsSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const prisma = getPrismaClient();
    const userId = req.user!.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });

    const currentSettings = (user?.settings as any) || {};
    const updatedSettings = {
      ...currentSettings,
      privacy: {
        ...(currentSettings.privacy || {}),
        ...value,
      },
    };

    await prisma.user.update({
      where: { id: userId },
      data: { settings: updatedSettings },
    });

    res.json({
      success: true,
      data: updatedSettings.privacy,
      message: 'Privacy settings updated successfully',
    });
  } catch (error) {
    throw error;
  }
});

// GET /api/v1/me/export - Export user data
router.get('/export', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const prisma = getPrismaClient();
    const userId = req.user!.id;

    // Fetch all user data
    const [user, tasks, projects, goals, alarms, reminders, routines, timers, weeklyReviews] =
      await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          timezone: true,
          settings: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.task.findMany({
        where: { creatorId: userId },
      }),
      prisma.project.findMany({
        where: { ownerId: userId },
      }),
      prisma.goal.findMany({
        where: { userId },
        include: { milestones: true },
      }),
      prisma.alarm.findMany({
        where: { userId },
      }),
      prisma.reminder.findMany({
        where: { userId },
      }),
      prisma.routine.findMany({
        where: { userId },
        include: { routineTasks: true },
      }),
      prisma.timer.findMany({
        where: { userId },
      }),
      prisma.weeklyReview.findMany({
        where: { userId },
      }),
    ]);

    const exportData = {
      user,
      tasks,
      projects,
      goals,
      alarms,
      reminders,
      routines,
      timers,
      weeklyReviews,
      exportedAt: new Date().toISOString(),
    };

    res.json({
      success: true,
      data: exportData,
      message: 'Data exported successfully',
    });
  } catch (error) {
    throw error;
  }
});

// DELETE /api/v1/me/data - Delete all user data (except account)
// router.delete('/data', async (req: AuthenticatedRequest, res: Response) => {
//   try {
//     const prisma = getPrismaClient();
//     const userId = req.user!.id;

//     // Delete all user data in a transaction
//     await prisma.$transaction(async (tx) => {
//       await tx.task.deleteMany({ where: { creatorId: userId } });
//       await tx.goal.deleteMany({ where: { userId } });
//       await tx.alarm.deleteMany({ where: { userId } });
//       await tx.reminder.deleteMany({ where: { userId } });
//       await tx.routine.deleteMany({ where: { userId } });
//       await tx.timer.deleteMany({ where: { userId } });
//       await tx.weeklyReview.deleteMany({ where: { userId } });
//       await tx.notification.deleteMany({ where: { userId } });
//       await tx.projectMember.deleteMany({ where: { userId } });
//     });

//     res.json({
//       success: true,
//       message: 'All data deleted successfully',
//     });
//   } catch (error) {
//     throw error;
//   }
// });



// routes/user.routes.ts or wherever your routes are defined

/**
 * DELETE /api/v1/me - Delete user account and all associated data
 * This is for Google Play validation - permanently deletes the user account
 */
router.delete('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const prisma = getPrismaClient();
    const userId = req.user!.id;

    // Delete user and all related data in a transaction
    // Due to cascade deletes in the schema, this will clean up everything
    await prisma.$transaction(async (tx) => {
      // 1. Delete user's refresh tokens
      await tx.refreshToken.deleteMany({
        where: { userId },
      });

      // 2. Delete password reset tokens
      await tx.passwordResetToken.deleteMany({
        where: { userId },
      });

      // 3. Delete notifications
      await tx.notification.deleteMany({
        where: { userId },
      });

      // 4. Delete reminders
      await tx.reminder.deleteMany({
        where: { userId },
      });

      // 5. Delete analytics events
      await tx.analyticsEvent.deleteMany({
        where: { userId },
      });

      // 6. Delete AI usage logs
      // await tx.aiUsageLog.deleteMany({
      //   where: { userId },
      // });

      // 7. Delete weekly reviews
      await tx.weeklyReview.deleteMany({
        where: { userId },
      });

      // 8. Delete user subscription
      await tx.userSubscription.deleteMany({
        where: { userId },
      });

      // 9. Delete routine tasks and routines
      await tx.routineTask.deleteMany({
        where: {
          routine: {
            userId,
          },
        },
      });
      await tx.routine.deleteMany({
        where: { userId },
      });

      // 10. Delete timer sessions and timers
      await tx.timerSession.deleteMany({
        where: { userId },
      });
      await tx.timer.deleteMany({
        where: { userId },
      });

      // 11. Delete alarms
      await tx.alarm.deleteMany({
        where: { userId },
      });

      // 12. Delete tasks (both created and assigned)
      // Note: Tasks with SetNull will have creatorId set to null
      await tx.task.deleteMany({
        where: {
          OR: [
            { creatorId: userId },
            { assigneeId: userId },
          ],
        },
      });

      // 13. Delete goals
      await tx.goal.deleteMany({
        where: { userId },
      });

      // 14. Delete milestones
      await tx.milestone.deleteMany({
        where: {
          OR: [
            { goal: { userId } },
            { project: { ownerId: userId } },
          ],
        },
      });

      // 15. Delete project-related data
      // Project comments
      await tx.projectComment.deleteMany({
        where: { userId },
      });

      // Project activities
      await tx.projectActivity.deleteMany({
        where: { userId },
      });

      // Project files
      await tx.projectFile.deleteMany({
        where: { userId },
      });

      // Project notifications
      await tx.projectNotification.deleteMany({
        where: { userId },
      });

      // Project invitations (both sent and received)
      await tx.projectInvitation.deleteMany({
        where: {
          OR: [
            { invitedBy: userId },
            { email: req.user!.email },
          ],
        },
      });

      // Project members
      await tx.projectMember.deleteMany({
        where: { userId },
      });

      // Project templates
      await tx.projectTemplate.deleteMany({
        where: { createdBy: userId },
      });

      // Projects owned by user (cascade will delete related data)
      await tx.project.deleteMany({
        where: { ownerId: userId },
      });

      // 16. Finally, delete the user
      const deletedUser = await tx.user.delete({
        where: { id: userId },
      });

      logger.info(`User account deleted: ${userId}`);
      return deletedUser;
    });

    res.json({
      success: true,
      message: 'Account deleted successfully',
    });
  } catch (error) {
    logger.error('Failed to delete user account:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete account',
    });
  }
});

/**
 * DELETE /api/v1/me/data - Delete all user data but keep account
 * This clears all user-generated content while preserving the account
 */
router.delete('/data', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const prisma = getPrismaClient();
    const userId = req.user!.id;

    logger.info(`Clearing all data for user: ${userId}`);

    await prisma.$transaction(async (tx) => {
      // 1. Delete AI usage logs
      // await tx.aiUsageLog.deleteMany({
      //   where: { userId },
      // });

      // 2. Delete weekly reviews
      await tx.weeklyReview.deleteMany({
        where: { userId },
      });

      // 3. Delete routine tasks and routines
      await tx.routineTask.deleteMany({
        where: {
          routine: {
            userId,
          },
        },
      });
      await tx.routine.deleteMany({
        where: { userId },
      });

      // 4. Delete timer sessions and timers
      await tx.timerSession.deleteMany({
        where: { userId },
      });
      await tx.timer.deleteMany({
        where: { userId },
      });

      // 5. Delete alarms
      await tx.alarm.deleteMany({
        where: { userId },
      });

      // 6. Delete notifications
      await tx.notification.deleteMany({
        where: { userId },
      });

      // 7. Delete reminders
      await tx.reminder.deleteMany({
        where: { userId },
      });

      // 8. Delete analytics events
      await tx.analyticsEvent.deleteMany({
        where: { userId },
      });

      // 9. Delete tasks (both created and assigned)
      await tx.task.deleteMany({
        where: {
          OR: [
            { creatorId: userId },
            { assigneeId: userId },
          ],
        },
      });

      // 10. Delete goals
      await tx.goal.deleteMany({
        where: { userId },
      });

      // 11. Delete milestones
      await tx.milestone.deleteMany({
        where: {
          OR: [
            { goal: { userId } },
            { project: { ownerId: userId } },
          ],
        },
      });

      // 12. Delete project-related data
      await tx.projectComment.deleteMany({
        where: { userId },
      });

      await tx.projectActivity.deleteMany({
        where: { userId },
      });

      await tx.projectFile.deleteMany({
        where: { userId },
      });

      await tx.projectNotification.deleteMany({
        where: { userId },
      });

      await tx.projectInvitation.deleteMany({
        where: {
          OR: [
            { invitedBy: userId },
            { email: req.user!.email },
          ],
        },
      });

      await tx.projectMember.deleteMany({
        where: { userId },
      });

      await tx.projectTemplate.deleteMany({
        where: { createdBy: userId },
      });

      // 11. Remove user from projects (set as null where applicable)
      // Update tasks where user is assignee to remove assignment
      await tx.task.updateMany({
        where: { assigneeId: userId },
        data: { assigneeId: null },
      });

      // Update tasks where user is creator (keep but remove creator)
      await tx.task.updateMany({
        where: { creatorId: userId },
        data: { creatorId: userId }, // Keep as creator, or set to a system user
      });

      // 12. Delete projects owned by user
      await tx.project.deleteMany({
        where: { ownerId: userId },
      });

      // 13. Keep user account but clear some fields if needed
      // Uncomment if you want to anonymize the user data
      // await tx.user.update({
      //   where: { id: userId },
      //   data: {
      //     name: 'Deleted User',
      //     email: `deleted_${userId}@deleted.com`,
      //     // Don't clear passwordHash or user can't login
      //   },
      // });

      logger.info(`All data cleared for user: ${userId}`);
    });

    res.json({
      success: true,
      message: 'All data deleted successfully. Your account has been preserved.',
    });
  } catch (error) {
    logger.error('Failed to delete user data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete data',
    });
  }
});


export default router;

