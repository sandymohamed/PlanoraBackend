/**
 * Push notifications stub — install firebase-admin and restore full service when ready.
 */
import { logger } from '../../shared/utils/logger';

class PushNotificationService {
  static getInstance() {
    return new PushNotificationService();
  }

  isAvailable(): boolean {
    return false;
  }

  async sendPushNotification(...args: unknown[]): Promise<void> {
    logger.debug('[Push] Skipped (firebase-admin not configured)', args[0]);
  }
}

export const pushNotificationService = PushNotificationService.getInstance();
