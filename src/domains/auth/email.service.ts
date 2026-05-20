/**
 * Email stub — install nodemailer and restore full EmailService from legacy backend when ready.
 */
import { logger } from '../../shared/utils/logger';

class EmailService {
  async sendPasswordResetOTP(data: { email: string; otp: string; name?: string }): Promise<void> {
    logger.info(`[Email] Password reset OTP for ${data.email}: ${data.otp}`);
  }

  async sendProjectInvitation(...args: unknown[]): Promise<void> {
    logger.debug('[Email] Invitation skipped (SMTP not configured)', args);
  }
}

export const emailService = new EmailService();
