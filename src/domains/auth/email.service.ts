// // email.services.ts
// import nodemailer from "nodemailer";
// import { logger } from "../../shared/utils/logger";

// interface EmailOptions {
//   to: string;
//   subject: string;
//   html: string;
//   text?: string;
// }

// class EmailService {
//   private transporter: nodemailer.Transporter | null = null;

//   constructor() {
//     if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
//       logger.warn(
//         "Email service not configured. Set SMTP_USER and SMTP_PASS to send mail.",
//       );
//       return;
//     }

//     console.log("Email service configured", {
//       host: process.env.SMTP_HOST || "smtp.gmail.com",
//       port: parseInt(process.env.SMTP_PORT || "587", 10),
//       secure: process.env.SMTP_SECURE === "true",
//       user: process.env.SMTP_USER,
//       from:
//         process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@planora.app",
//     });

//     this.transporter = nodemailer.createTransport({
//       host: process.env.SMTP_HOST || "smtp.gmail.com",
//       port: parseInt(process.env.SMTP_PORT || "587", 10),
//       secure: process.env.SMTP_SECURE === "true",
//       connectionTimeout: parseInt(
//         process.env.SMTP_CONNECTION_TIMEOUT_MS || "10000",
//         10,
//       ),
//       greetingTimeout: parseInt(
//         process.env.SMTP_GREETING_TIMEOUT_MS || "10000",
//         10,
//       ),
//       socketTimeout: parseInt(
//         process.env.SMTP_SOCKET_TIMEOUT_MS || "10000",
//         10,
//       ),
//       auth: {
//         user: process.env.SMTP_USER,
//         pass: process.env.SMTP_PASS,
//       },
//       tls: {
//         rejectUnauthorized:
//           process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
//       },

//       logger: true,
//       debug: true,
//     });
//   }

//   private get fromAddress(): string {
//     const app = process.env.APP_NAME || "Planora AI";
//     const from =
//       process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@planora.app";
//     return `"${app}" <${from}>`;
//   }

//   /** True when SMTP credentials are present and a transporter was created. */
//   isConfigured(): boolean {
//     return this.transporter !== null;
//   }

//   /**
//    * Verify the SMTP connection/credentials. Returns false (never throws) so it
//    * can be used safely in health checks and startup logging.
//    */
//   async verifyConnection(): Promise<boolean> {
//     if (!this.transporter) {
//       logger.warn("SMTP verify skipped (transporter not configured)");
//       return false;
//     }
//     try {
//       logger.info("SMTP verify started");
//       await this.transporter.verify();
//       logger.info("SMTP verify succeeded");
//       return true;
//     } catch (error) {
//       logger.warn("SMTP verification failed", {
//         error: (error as Error)?.message,
//       });
//       return false;
//     }
//   }

  
//   async sendEmail(options: EmailOptions): Promise<boolean> {
//     if (process.env.RESEND_EMAIL_ENABLED === "true") {
//       // ADD code 
    
//       console.log("Email sent via Resend:", result);
//       return true;
//     }

//     if (!this.transporter) {
//       console.log("Transporter is null");
//       return false;
//     }

//     try {
 
//       await this.transporter.verify();
 
//       const result = await this.transporter.sendMail({
//         from: this.fromAddress,
//         to: options.to,
//         subject: options.subject,
//         html: options.html,
//         text: options.text,
//       });

//       return true;
//     } catch (err) {
//       console.error(err);

//       return false;
//     }
//   }

//   async sendPasswordResetOTP(data: {
//     email: string;
//     otp: string;
//     name?: string;
//   }): Promise<boolean> {
//     const { email, otp, name } = data;
//     const appName = process.env.APP_NAME || "Planora AI";
//     logger.info("Password reset email step: building OTP email", {
//       email,
//       appName,
//       hasName: Boolean(name),
//     });

//     const html = `
//       <!DOCTYPE html>
//       <html>
//       <head><meta charset="utf-8"><title>Password Reset</title></head>
//       <body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
//         <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:30px;text-align:center;border-radius:10px 10px 0 0;">
//           <h1>Password Reset</h1>
//           <p>Your verification code</p>
//         </div>
//         <div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px;">
//           <p>Hello${name ? ` ${name}` : ""},</p>
//           <p>Use this code to reset your ${appName} password:</p>
//           <div style="background:#fff;padding:24px;text-align:center;border-radius:8px;margin:20px 0;">
//             <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#6366f1;">${otp}</span>
//             <p style="color:#666;font-size:12px;margin-top:12px;">Expires in 10 minutes</p>
//           </div>
//           <p style="color:#666;font-size:14px;">If you did not request this, ignore this email.</p>
//         </div>
//       </body>
//       </html>
//     `;

//     const text = `Password reset for ${appName}\n\nOTP: ${otp}\n\nExpires in 10 minutes.\n`;

//     logger.info("Password reset email step: OTP email built", { email });

//     const sent = await this.sendEmail({
//       to: email,
//       subject: `${appName} — Password reset code`,
//       html,
//       text,
//     });
//     logger.info("Password reset email step: sendEmail returned", {
//       email,
//       sent,
//     });
//     return sent;
//   }
// }

// export const emailService = new EmailService();

// email.service.ts
import { logger } from "../../shared/utils/logger";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

class EmailService {
  private apiKey: string | null = null;
  private fromEmail: string;

  constructor() {
    // Get Brevo API key
    this.apiKey = process.env.BREVO_API_KEY || null;
    this.fromEmail = process.env.SMTP_FROM || "tasksmoderatorapp@gmail.com";

    if (!this.apiKey) {
      logger.warn(
        "Brevo API key not configured. Set BREVO_API_KEY to send mail."
      );
    } else {
      logger.info("Email service initialized with Brevo API", {
        from: this.fromEmail,
        hasApiKey: true,
      });
    }
  }

  private get fromAddress(): string {
    const app = process.env.APP_NAME || "Planora AI";
    return `"${app}" <${this.fromEmail}>`;
  }

  /** True when email is configured */
  isConfigured(): boolean {
    return this.apiKey !== null;
  }

  /**
   * Verify the email connection/credentials.
   */
  async verifyConnection(): Promise<boolean> {
    if (!this.apiKey) {
      logger.warn("Brevo verify skipped (API key not configured)");
      return false;
    }

    try {
      // Test the API key with a simple validation
      const response = await fetch("https://api.brevo.com/v3/account", {
        method: "GET",
        headers: {
          "api-key": this.apiKey,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        logger.info("Brevo API verification succeeded");
        return true;
      } else {
        const error = await response.json();
        logger.warn("Brevo API verification failed", { error });
        return false;
      }
    } catch (error) {
      logger.warn("Brevo API verification failed", {
        error: (error as Error)?.message,
      });
      return false;
    }
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    if (!this.apiKey) {
      logger.error("Brevo API key not configured");
      return false;
    }

    try {
      logger.info("Sending email via Brevo API", { to: options.to });

      // Prepare the email payload for Brevo API
      const payload = {
        sender: {
          name: process.env.APP_NAME || "Planora AI",
          email: this.fromEmail,
        },
        to: [
          {
            email: options.to,
          },
        ],
        subject: options.subject,
        htmlContent: options.html,
        textContent: options.text || options.html.replace(/<[^>]*>/g, ""), // Strip HTML for text version
      };

      // Send via Brevo API (uses HTTPS, not SMTP)
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": this.apiKey,
        },
        body: JSON.stringify(payload),
      });

      const responseData: any = await response.json();

      if (!response.ok) {
        logger.error("Brevo API error", {
          status: response.status,
          error: responseData,
        });
        return false;
      }

      logger.info("Email sent via Brevo API successfully", {
        to: options.to,
        messageId: responseData?.messageId,
      });

      return true;
    } catch (error) {
      logger.error("Email send failed via Brevo API", {
        error: (error as Error)?.message,
        to: options.to,
      });
      return false;
    }
  }

  async sendPasswordResetOTP(data: {
    email: string;
    otp: string;
    name?: string;
  }): Promise<boolean> {
    const { email, otp, name } = data;
    const appName = process.env.APP_NAME || "Planora AI";

    logger.info("Password reset email step: building OTP email", {
      email,
      appName,
      hasName: Boolean(name),
    });

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: #fff;
            padding: 30px;
            text-align: center;
            border-radius: 10px 10px 0 0;
          }
          .content {
            background: #f9f9f9;
            padding: 30px;
            border-radius: 0 0 10px 10px;
          }
          .otp-box {
            background: #fff;
            padding: 24px;
            text-align: center;
            border-radius: 8px;
            margin: 20px 0;
          }
          .otp-code {
            font-size: 32px;
            font-weight: bold;
            letter-spacing: 8px;
            color: #6366f1;
          }
          .expiry {
            color: #666;
            font-size: 12px;
            margin-top: 12px;
          }
          .footer-text {
            color: #666;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Password Reset</h1>
          <p>Your verification code</p>
        </div>
        <div class="content">
          <p>Hello${name ? ` ${name}` : ""},</p>
          <p>Use this code to reset your ${appName} password:</p>
          <div class="otp-box">
            <div class="otp-code">${otp}</div>
            <div class="expiry">Expires in 10 minutes</div>
          </div>
          <p class="footer-text">If you did not request this, ignore this email.</p>
        </div>
      </body>
      </html>
    `;

    const text = `Password reset for ${appName}\n\nOTP: ${otp}\n\nExpires in 10 minutes.\n\nIf you did not request this, ignore this email.`;

    logger.info("Password reset email step: OTP email built", { email });

    const sent = await this.sendEmail({
      to: email,
      subject: `${appName} — Password reset code`,
      html,
      text,
    });

    logger.info("Password reset email step: sendEmail returned", {
      email,
      sent,
    });

    return sent;
  }
}

export const emailService = new EmailService();