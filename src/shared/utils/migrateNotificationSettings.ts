// utils/migrateNotificationSettings.ts

import { Prisma } from "@prisma/client";

export const DEFAULT_NOTIFICATION_SETTINGS = {
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

export function migrateNotificationSettings(
  settings: Prisma.JsonObject | null | undefined,
): {
  settings: Prisma.JsonObject;
  migrated: boolean;
} {
  const current = (settings ?? {}) as any;
  const notifications = current.notifications ?? {};

  // Already using the new structure
  if ("push" in notifications) {
    // Convert old structure -> new structure
    const migratedSettings = {
      ...current,
      notifications: {
        ...DEFAULT_NOTIFICATION_SETTINGS,

        pushNotifications: notifications.push ?? true,
        emailNotifications: notifications.email ?? false,

        // No equivalent in old structure
        taskReminders: true,
        goalReminders: true,
        projectInvitations: true,
        taskAssignments: true,
        taskComments: true,
        dueDateReminders: true,
        weeklyDigest: false,
        monthlyReport: false,
        marketingEmails: false,
      },
    };

    return {
      settings: migratedSettings,
      migrated: true,
    };
  }
  return {
    settings: current,
    migrated: false,
  };
}
