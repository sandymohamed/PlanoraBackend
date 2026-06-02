import nodemailer from 'nodemailer';
import { logger } from '../../shared/utils/logger';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      logger.warn('Email service not configured. Set SMTP_USER and SMTP_PASS to send mail.');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
      },
    });
  }

  private get fromAddress(): string {
    const app = process.env.APP_NAME || 'Planora AI';
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@planora.app';
    return `"${app}" <${from}>`;
  }

  /** True when SMTP credentials are present and a transporter was created. */
  isConfigured(): boolean {
    return this.transporter !== null;
  }

  /**
   * Verify the SMTP connection/credentials. Returns false (never throws) so it
   * can be used safely in health checks and startup logging.
   */
  async verifyConnection(): Promise<boolean> {
    if (!this.transporter) return false;
    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      logger.warn('SMTP verification failed', { error: (error as Error)?.message });
      return false;
    }
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    if (!this.transporter) {
      logger.warn('Email skipped (SMTP not configured)', { to: options.to, subject: options.subject });
      return false;
    }

    try {
      const result = await this.transporter.sendMail({
        from: this.fromAddress,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
      logger.info('Email sent', { messageId: result.messageId, to: options.to });
      return true;
    } catch (error) {
      logger.error('Failed to send email', error);
      return false;
    }
  }

  async sendPasswordResetOTP(data: { email: string; otp: string; name?: string }): Promise<void> {
    const { email, otp, name } = data;
    const appName = process.env.APP_NAME || 'Planora AI';

    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>Password Reset</title></head>
      <body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:30px;text-align:center;border-radius:10px 10px 0 0;">
          <h1>Password Reset</h1>
          <p>Your verification code</p>
        </div>
        <div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px;">
          <p>Hello${name ? ` ${name}` : ''},</p>
          <p>Use this code to reset your ${appName} password:</p>
          <div style="background:#fff;padding:24px;text-align:center;border-radius:8px;margin:20px 0;">
            <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#6366f1;">${otp}</span>
            <p style="color:#666;font-size:12px;margin-top:12px;">Expires in 10 minutes</p>
          </div>
          <p style="color:#666;font-size:14px;">If you did not request this, ignore this email.</p>
        </div>
      </body>
      </html>
    `;

    const text = `Password reset for ${appName}\n\nOTP: ${otp}\n\nExpires in 10 minutes.\n`;

    await this.sendEmail({
      to: email,
      subject: `${appName} — Password reset code`,
      html,
      text,
    });
  }
}

export const emailService = new EmailService();
