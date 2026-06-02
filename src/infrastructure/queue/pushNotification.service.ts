import * as fs from 'fs';
import { logger } from '../../shared/utils/logger';
import { getPrismaClient } from '../../shared/utils/database';

type FirebaseAdmin = typeof import('firebase-admin');

let admin: FirebaseAdmin | null = null;
let firebaseInitialized = false;

function initializeFirebase(): void {
  if (firebaseInitialized) return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    admin = require('firebase-admin') as FirebaseAdmin;
  } catch {
    logger.warn('firebase-admin not installed — push notifications disabled');
    return;
  }

  try {
    if (admin!.apps.length > 0) {
      firebaseInitialized = true;
      return;
    }

    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      admin!.initializeApp({ credential: admin!.credential.cert(serviceAccount) });
    } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
      admin!.initializeApp({
        credential: admin!.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });
    } else {
      logger.warn('Firebase not configured — set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_* env vars');
      return;
    }

    firebaseInitialized = true;
    logger.info('Firebase Admin SDK initialized');
  } catch (error) {
    logger.error('Firebase initialization failed', error);
  }
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: string;
  badge?: number;
  imageUrl?: string;
}

interface UserPushToken {
  token: string;
  platform: 'android' | 'ios';
  registeredAt: string;
}

const APP_NAME = process.env.APP_NAME || 'Planora AI';

class PushNotificationService {
  private static instance: PushNotificationService;

  private constructor() {
    initializeFirebase();
  }

  static getInstance(): PushNotificationService {
    if (!PushNotificationService.instance) {
      PushNotificationService.instance = new PushNotificationService();
    }
    return PushNotificationService.instance;
  }

  isAvailable(): boolean {
    return firebaseInitialized && !!admin && admin.apps.length > 0;
  }

  async getUserPushTokens(userId: string): Promise<UserPushToken[]> {
    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
    const settings = (user?.settings as Record<string, unknown>) || {};
    const pushTokens = (settings.pushTokens as UserPushToken[]) || [];
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return pushTokens.filter((t) => new Date(t.registeredAt).getTime() > thirtyDaysAgo);
  }

  async sendPushNotification(
    userId: string,
    payload: PushNotificationPayload,
    checkPreferences = true
  ): Promise<boolean> {
    if (!this.isAvailable() || !admin) {
      logger.debug('[Push] Skipped — Firebase not available');
      return false;
    }

    if (checkPreferences) {
      const prisma = getPrismaClient();
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
      const notifications = ((user?.settings as Record<string, unknown>)?.notifications || {}) as Record<string, boolean>;
      if (notifications.pushNotifications === false) return false;
    }

    const tokens = await this.getUserPushTokens(userId);
    if (tokens.length === 0) return false;

    const data = payload.data || {};
    const isAlarmTrigger = data.notificationType === 'ALARM_TRIGGER' || data.type === 'alarm';
    const isReminderType =
      data.type === 'TASK_REMINDER' || data.type === 'DUE_DATE_REMINDER' || data.type === 'ROUTINE_REMINDER';
    // 'alarm_channel' is created natively (AlarmPlayerService) and registered as the
    // FCM default channel in AndroidManifest, so it always exists on the device.
    const channelId = 'alarm_channel';

    let successCount = 0;
    for (const tokenInfo of tokens) {
      try {
        await admin.messaging().send({
          token: tokenInfo.token,
          notification: { title: payload.title || APP_NAME, body: payload.body },
          data: { ...data, type: data.type || data.notificationType || 'notification' },
          android: {
            priority: 'high',
            notification: {
              channelId,
              sound: isAlarmTrigger ? undefined : isReminderType ? 'alarm' : payload.sound || 'default',
            },
          },
        });
        successCount++;
      } catch (error) {
        logger.error('Push send failed for token', error);
      }
    }

    return successCount > 0;
  }
}

export const pushNotificationService = PushNotificationService.getInstance();
