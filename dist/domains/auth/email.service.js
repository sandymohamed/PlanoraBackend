"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailService = void 0;
/**
 * Email stub — install nodemailer and restore full EmailService from legacy backend when ready.
 */
const logger_1 = require("../../shared/utils/logger");
class EmailService {
    async sendPasswordResetOTP(data) {
        logger_1.logger.info(`[Email] Password reset OTP for ${data.email}: ${data.otp}`);
    }
    async sendProjectInvitation(...args) {
        logger_1.logger.debug('[Email] Invitation skipped (SMTP not configured)', args);
    }
}
exports.emailService = new EmailService();
