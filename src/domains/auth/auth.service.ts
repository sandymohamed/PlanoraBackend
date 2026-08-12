// auth.services.ts
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt, { SignOptions } from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { getPrismaClient } from "../../shared/utils/database";
import { logger } from "../../shared/utils/logger";
import {
  JWTPayload,
  AuthenticationError,
  ConflictError,
} from "../../shared/types";

const SALT_ROUNDS = 12;

export interface SignupData {
  email: string;
  password: string;
  name: string;
  timezone?: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export class AuthService {
  private static parseDurationMs(
    value: string | undefined,
    fallback: string,
  ): number {
    const raw = (value || fallback).trim();
    const match = raw.match(/^(\d+)([smhd])?$/i);
    if (!match) {
      return AuthService.parseDurationMs(fallback, "30d");
    }

    const amount = Number(match[1]);
    const unit = (match[2] || "s").toLowerCase();
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return amount * multipliers[unit];
  }

  private static accessExpiresInSeconds(): number {
    return Math.floor(
      AuthService.parseDurationMs(process.env.JWT_EXPIRES_IN, "15m") / 1000,
    );
  }

  private static refreshExpiresAt(): Date {
    return new Date(
      Date.now() +
        AuthService.parseDurationMs(process.env.JWT_REFRESH_EXPIRES_IN, "30d"),
    );
  }

  private static hashRefreshToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  private static generateTokens(userId: string, email: string): AuthTokens {
    const accessToken = jwt.sign(
      { userId, email } as JWTPayload,
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN || "15m" } as SignOptions,
    );

    const refreshToken = jwt.sign(
      { userId, email, type: "refresh", jti: uuidv4() } as JWTPayload & {
        type: string;
        jti: string;
      },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d" } as SignOptions,
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: AuthService.accessExpiresInSeconds(),
    };
  }

  static async signup(
    data: SignupData,
  ): Promise<{ user: any; tokens: AuthTokens }> {
    const prisma = getPrismaClient();

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictError(
        "This email is already registered. Sign in or use a different email.",
        "EMAIL_EXISTS",
        "email",
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        passwordHash,
        name: data.name,
        timezone: data.timezone || "UTC",
        settings: {
          notifications: {
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
          },
          theme: "system",
          language: "en",
        },
      },
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

    // Generate tokens
    const tokens = this.generateTokens(user.id, user.email);

    const refreshExpiresAt = AuthService.refreshExpiresAt();
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: AuthService.hashRefreshToken(tokens.refreshToken),
        expiresAt: refreshExpiresAt,
      },
    });

    logger.info("User signed up successfully", {
      userId: user.id,
      email: user.email,
    });

    return { user, tokens };
  }

  static async login(
    data: LoginData,
  ): Promise<{ user: any; tokens: AuthTokens }> {
    const prisma = getPrismaClient();

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
    });

    if (!user) {
      throw new AuthenticationError();
    }

    const isValidPassword = await bcrypt.compare(
      data.password,
      user.passwordHash,
    );
    if (!isValidPassword) {
      throw new AuthenticationError();
    }

    // Generate tokens
    const tokens = this.generateTokens(user.id, user.email);

    const refreshExpiresAt = AuthService.refreshExpiresAt();
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: AuthService.hashRefreshToken(tokens.refreshToken),
        expiresAt: refreshExpiresAt,
      },
    });

    // Clean up old refresh tokens (keep only last 5)
    const oldTokens = await prisma.refreshToken.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      skip: 4, // Keep 4 most recent + current
    });

    if (oldTokens.length > 0) {
      await prisma.refreshToken.deleteMany({
        where: {
          id: { in: oldTokens.map((t) => t.id) },
        },
      });
    }


    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        timezone: user.timezone,
        settings: user.settings,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      tokens,
    };
  }

  static async refreshToken(refreshToken: string): Promise<AuthTokens> {
    const prisma = getPrismaClient();
    const tokenHash = AuthService.hashRefreshToken(refreshToken);

    // New tokens are stored as SHA-256 hashes. Fall back to raw lookup so existing
    // sessions issued before this change survive until their next successful refresh.
    let storedTokenValue = tokenHash;
    let tokenRecord = await prisma.refreshToken.findUnique({
      where: { token: tokenHash },
      include: { user: true },
    });

    if (!tokenRecord) {
      tokenRecord = await prisma.refreshToken.findUnique({
        where: { token: refreshToken },
        include: { user: true },
      });
      storedTokenValue = refreshToken;
    }

    if (!tokenRecord) {
    
      throw new AuthenticationError("Invalid refresh token");
    }

    // Database expiration is checked before rotation so revoked/expired sessions
    // cannot mint a fresh access token.
    if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
      // Clean up expired token
      await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });

      throw new AuthenticationError("Refresh token expired");
    }

    // Verify the refresh JWT normally. DB storage lets us revoke sessions; JWT exp
    // remains the cryptographic max lifetime.
    let decoded: JWTPayload & { type?: string };
    try {
      decoded = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET!,
      ) as JWTPayload & { type?: string };
    } catch (error: any) {
      logger.warn("Refresh token JWT verification failed", {
        error: error.name,
        message: error.message,
        tokenId: tokenRecord.id,
      });
      await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });
      throw new AuthenticationError("Invalid refresh token");
    }

    if (decoded.type !== "refresh" || decoded.userId !== tokenRecord.userId) {
      await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });
      throw new AuthenticationError("Invalid refresh token");
    }

    // Generate new tokens
    const tokens = this.generateTokens(
      tokenRecord.user.id,
      tokenRecord.user.email,
    );
    const newRefreshTokenHash = AuthService.hashRefreshToken(
      tokens.refreshToken,
    );

    // Atomic rotation: update only if the presented token is still current. This
    // prevents two concurrent refreshes from both receiving valid-looking tokens.
    const refreshExpiresAt = AuthService.refreshExpiresAt();
    const rotated = await prisma.refreshToken.updateMany({
      where: {
        id: tokenRecord.id,
        token: storedTokenValue,
      },
      data: {
        token: newRefreshTokenHash,
        expiresAt: refreshExpiresAt,
      },
    });

    if (rotated.count !== 1) {
      logger.warn("Refresh token rotation race detected", {
        tokenId: tokenRecord.id,
        userId: tokenRecord.userId,
      });
      throw new AuthenticationError("Refresh token already rotated");
    }

    logger.info("Tokens refreshed successfully", {
      userId: tokenRecord.user.id,
    });

    return tokens;
  }

  static async logout(refreshToken?: string): Promise<void> {
    const prisma = getPrismaClient();

    // Remove refresh token from database if provided
    if (refreshToken) {
      const tokenHash = AuthService.hashRefreshToken(refreshToken);
      await prisma.refreshToken.deleteMany({
        where: { token: { in: [tokenHash, refreshToken] } },
      });
    }

    logger.info("User logged out successfully");
  }

  static async logoutAll(userId: string): Promise<void> {
    const prisma = getPrismaClient();

    // Remove all refresh tokens for user
    await prisma.refreshToken.deleteMany({
      where: { userId },
    });

    logger.info("User logged out from all devices", { userId });
  }

  static async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const prisma = getPrismaClient();

    // Get user with password hash
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (!user) {
      throw new AuthenticationError("User not found");
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(
      currentPassword,
      user.passwordHash,
    );
    if (!isValidPassword) {
      throw new AuthenticationError("Current password is incorrect");
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    // Logout from all devices
    await this.logoutAll(userId);

    logger.info("Password changed successfully", { userId });
  }

  static async requestPasswordReset(
    email: string,
    traceId?: string,
  ): Promise<void> {
    const prisma = getPrismaClient();

    const { emailService } = await import("./email.service");


    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true },
    });
 

    // Don't reveal if user exists or not (security best practice)
    if (!user) {
      logger.warn("Password reset requested for non-existent email", {
        traceId,
        email,
      });
      return; // Silent fail for security
    }

    const { randomInt } = await import("crypto");
    const otp = randomInt(100000, 1000000).toString();

    // Generate reset token
    const resetToken = uuidv4();

    // Set expiration (10 minutes)
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);

    // Delete any existing reset tokens for this user

    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });

    // Create new reset token
    try {
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          email: user.email,
          otp,
          token: resetToken,
          expiresAt,
        },
      });
    } catch (error) {
      console.error("Password reset step: reset token create failed", {
        traceId,
        email,
        userId: user.id,
        error,
      });
      throw error;
    }
 

    // Send OTP email. Keep the API response generic, but log delivery failures
    // so deployment SMTP issues are visible without exposing account existence.

    const emailSent = await emailService.sendPasswordResetOTP({
      email: user.email,
      otp,
      name: user.name || undefined,
    });
 
    if (emailSent) {
      return;
    }
  }

  static async verifyPasswordResetOTP(
    email: string,
    otp: string,
  ): Promise<string> {
    const prisma = getPrismaClient();

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      throw new AuthenticationError("Invalid OTP");
    }

    // Find valid reset token
    const resetToken = await prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        email,
        otp,
        expiresAt: { gt: new Date() },
        verified: false,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!resetToken) {
      throw new AuthenticationError("Invalid or expired OTP");
    }

    // Mark as verified
    await prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { verified: true },
    });

    // Return the reset token for password reset
    return resetToken.token;
  }

  static async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<void> {
    const prisma = getPrismaClient();

    // Find valid reset token
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (
      !resetToken ||
      !resetToken.verified ||
      resetToken.expiresAt < new Date()
    ) {
      throw new AuthenticationError("Invalid or expired reset token");
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Update password
    await prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash: newPasswordHash },
    });

    // Delete all reset tokens for this user
    await prisma.passwordResetToken.deleteMany({
      where: { userId: resetToken.userId },
    });

    // Logout from all devices
    await this.logoutAll(resetToken.userId);

    logger.info("Password reset successfully");
  }
}
