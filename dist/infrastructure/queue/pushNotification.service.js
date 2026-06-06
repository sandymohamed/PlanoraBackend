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
exports.pushNotificationService = void 0;
const fs = __importStar(require("fs"));
const logger_1 = require("../../shared/utils/logger");
const database_1 = require("../../shared/utils/database");
let admin = null;
let firebaseInitialized = false;
function initializeFirebase() {
    if (firebaseInitialized)
        return;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        admin = require('firebase-admin');
    }
    catch {
        logger_1.logger.warn('firebase-admin not installed — push notifications disabled');
        return;
    }
    try {
        if (admin.apps.length > 0) {
            firebaseInitialized = true;
            return;
        }
        const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
            const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
            admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        }
        else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                }),
            });
        }
        else {
            logger_1.logger.warn('Firebase not configured — set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_* env vars');
            return;
        }
        firebaseInitialized = true;
        logger_1.logger.info('Firebase Admin SDK initialized');
    }
    catch (error) {
        logger_1.logger.error('Firebase initialization failed', error);
    }
}
const APP_NAME = process.env.APP_NAME || 'Planora AI';
class PushNotificationService {
    constructor() {
        initializeFirebase();
    }
    static getInstance() {
        if (!PushNotificationService.instance) {
            PushNotificationService.instance = new PushNotificationService();
        }
        return PushNotificationService.instance;
    }
    isAvailable() {
        return firebaseInitialized && !!admin && admin.apps.length > 0;
    }
    async getUserPushTokens(userId) {
        const prisma = (0, database_1.getPrismaClient)();
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
        const settings = user?.settings || {};
        const pushTokens = settings.pushTokens || [];
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        return pushTokens.filter((t) => new Date(t.registeredAt).getTime() > thirtyDaysAgo);
    }
    async sendPushNotification(userId, payload, checkPreferences = true) {
        if (!this.isAvailable() || !admin) {
            logger_1.logger.debug('[Push] Skipped — Firebase not available');
            return false;
        }
        if (checkPreferences) {
            const prisma = (0, database_1.getPrismaClient)();
            const user = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
            const notifications = (user?.settings?.notifications || {});
            if (notifications.pushNotifications === false)
                return false;
        }
        const tokens = await this.getUserPushTokens(userId);
        if (tokens.length === 0)
            return false;
        const data = payload.data || {};
        const isAlarmTrigger = data.notificationType === 'ALARM_TRIGGER' || data.type === 'alarm';
        const isReminderType = data.type === 'TASK_REMINDER' || data.type === 'DUE_DATE_REMINDER' || data.type === 'ROUTINE_REMINDER';
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
            }
            catch (error) {
                logger_1.logger.error('Push send failed for token', error);
            }
        }
        return successCount > 0;
    }
}
exports.pushNotificationService = PushNotificationService.getInstance();
