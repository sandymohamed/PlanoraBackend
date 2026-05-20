"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushNotificationService = void 0;
/**
 * Push notifications stub — install firebase-admin and restore full service when ready.
 */
const logger_1 = require("../../shared/utils/logger");
class PushNotificationService {
    static getInstance() {
        return new PushNotificationService();
    }
    isAvailable() {
        return false;
    }
    async sendPushNotification(...args) {
        logger_1.logger.debug('[Push] Skipped (firebase-admin not configured)', args[0]);
    }
}
exports.pushNotificationService = PushNotificationService.getInstance();
