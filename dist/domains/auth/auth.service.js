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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uuid_1 = require("uuid");
const database_1 = require("../../shared/utils/database");
const logger_1 = require("../../shared/utils/logger");
const types_1 = require("../../shared/types");
const SALT_ROUNDS = 12;
class AuthService {
    static refreshExpiresAt() {
        const days = parseInt(process.env.JWT_REFRESH_EXPIRES_IN?.replace('d', '') || '30', 10);
        const d = new Date();
        d.setDate(d.getDate() + days);
        return d;
    }
    static generateTokens(userId, email) {
        const accessToken = jsonwebtoken_1.default.sign({ userId, email }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' });
        const refreshToken = jsonwebtoken_1.default.sign({ userId, email, type: 'refresh' }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' });
        return {
            accessToken,
            refreshToken,
            expiresIn: 15 * 60, // 15 minutes in seconds
        };
    }
    static async signup(data) {
        const prisma = (0, database_1.getPrismaClient)();
        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email: data.email.toLowerCase() },
        });
        if (existingUser) {
            throw new types_1.ConflictError('This email is already registered. Sign in or use a different email.', 'EMAIL_EXISTS', 'email');
        }
        // Hash password
        const passwordHash = await bcryptjs_1.default.hash(data.password, SALT_ROUNDS);
        // Create user
        const user = await prisma.user.create({
            data: {
                email: data.email.toLowerCase(),
                passwordHash,
                name: data.name,
                timezone: data.timezone || 'UTC',
                settings: {
                    notifications: {
                        email: true,
                        push: true,
                        inApp: true,
                    },
                    theme: 'system',
                    language: 'en',
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
                token: tokens.refreshToken,
                expiresAt: refreshExpiresAt,
            },
        });
        logger_1.logger.info('User signed up successfully', { userId: user.id, email: user.email });
        return { user, tokens };
    }
    static async login(data) {
        const prisma = (0, database_1.getPrismaClient)();
        // Find user
        const user = await prisma.user.findUnique({
            where: { email: data.email.toLowerCase() },
        });
        if (!user) {
            throw new types_1.AuthenticationError();
        }
        const isValidPassword = await bcryptjs_1.default.compare(data.password, user.passwordHash);
        if (!isValidPassword) {
            throw new types_1.AuthenticationError();
        }
        // Generate tokens
        const tokens = this.generateTokens(user.id, user.email);
        const refreshExpiresAt = AuthService.refreshExpiresAt();
        await prisma.refreshToken.create({
            data: {
                userId: user.id,
                token: tokens.refreshToken,
                expiresAt: refreshExpiresAt,
            },
        });
        // Clean up old refresh tokens (keep only last 5)
        const oldTokens = await prisma.refreshToken.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' },
            skip: 4, // Keep 4 most recent + current
        });
        if (oldTokens.length > 0) {
            await prisma.refreshToken.deleteMany({
                where: {
                    id: { in: oldTokens.map(t => t.id) },
                },
            });
        }
        logger_1.logger.info('User logged in successfully', { userId: user.id, email: user.email });
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
    static async refreshToken(refreshToken) {
        const prisma = (0, database_1.getPrismaClient)();
        // First check if token exists in database (this allows us to handle expired JWTs gracefully)
        const tokenRecord = await prisma.refreshToken.findUnique({
            where: { token: refreshToken },
            include: { user: true },
        });
        if (!tokenRecord) {
            logger_1.logger.warn('Refresh token not found in database', { token: refreshToken.substring(0, 20) + '...' });
            throw new types_1.AuthenticationError('Invalid refresh token');
        }
        // Check database expiration (this is the source of truth for new tokens)
        // Only check expiration if expiresAt is set and not far in the future (for legacy tokens)
        // New tokens have 100 year expiration, so this check will rarely fail
        if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
            // Clean up expired token
            await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });
            logger_1.logger.warn('Refresh token expired in database', {
                tokenId: tokenRecord.id,
                expiresAt: tokenRecord.expiresAt,
                now: new Date()
            });
            throw new types_1.AuthenticationError('Refresh token expired');
        }
        // Verify JWT signature (but allow expired JWTs if they're valid in database)
        // This handles cases where JWT might be expired but database says it's still valid
        try {
            // Try to verify without checking expiration first (verification throws if invalid)
            jsonwebtoken_1.default.verify(refreshToken, process.env.JWT_REFRESH_SECRET, {
                ignoreExpiration: true, // Ignore JWT expiration, use database expiration instead
            });
        }
        catch (error) {
            // If signature is invalid (not just expired), then it's truly invalid
            if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
                logger_1.logger.warn('Refresh token JWT verification failed', {
                    error: error.name,
                    message: error.message,
                    tokenId: tokenRecord.id
                });
                // Delete invalid token from database
                await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });
                throw new types_1.AuthenticationError('Invalid refresh token');
            }
            throw error;
        }
        // Generate new tokens
        const tokens = this.generateTokens(tokenRecord.user.id, tokenRecord.user.email);
        // Update refresh token in database with very long expiration (100 years, effectively never expires)
        const refreshExpiresAt = AuthService.refreshExpiresAt();
        await prisma.refreshToken.update({
            where: { id: tokenRecord.id },
            data: {
                token: tokens.refreshToken,
                expiresAt: refreshExpiresAt,
            },
        });
        logger_1.logger.info('Tokens refreshed successfully', { userId: tokenRecord.user.id });
        return tokens;
    }
    static async logout(refreshToken) {
        const prisma = (0, database_1.getPrismaClient)();
        // Remove refresh token from database if provided
        if (refreshToken) {
            await prisma.refreshToken.deleteMany({
                where: { token: refreshToken },
            });
        }
        logger_1.logger.info('User logged out successfully');
    }
    static async logoutAll(userId) {
        const prisma = (0, database_1.getPrismaClient)();
        // Remove all refresh tokens for user
        await prisma.refreshToken.deleteMany({
            where: { userId },
        });
        logger_1.logger.info('User logged out from all devices', { userId });
    }
    static async changePassword(userId, currentPassword, newPassword) {
        const prisma = (0, database_1.getPrismaClient)();
        // Get user with password hash
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { passwordHash: true },
        });
        if (!user) {
            throw new types_1.AuthenticationError('User not found');
        }
        // Verify current password
        const isValidPassword = await bcryptjs_1.default.compare(currentPassword, user.passwordHash);
        if (!isValidPassword) {
            throw new types_1.AuthenticationError('Current password is incorrect');
        }
        // Hash new password
        const newPasswordHash = await bcryptjs_1.default.hash(newPassword, SALT_ROUNDS);
        // Update password
        await prisma.user.update({
            where: { id: userId },
            data: { passwordHash: newPasswordHash },
        });
        // Logout from all devices
        await this.logoutAll(userId);
        logger_1.logger.info('Password changed successfully', { userId });
    }
    static async requestPasswordReset(email) {
        const prisma = (0, database_1.getPrismaClient)();
        const { emailService } = await Promise.resolve().then(() => __importStar(require('./email.service')));
        // Find user by email
        const user = await prisma.user.findUnique({
            where: { email },
            select: { id: true, email: true, name: true },
        });
        // Don't reveal if user exists or not (security best practice)
        if (!user) {
            logger_1.logger.warn('Password reset requested for non-existent email', { email });
            return; // Silent fail for security
        }
        const { randomInt } = await Promise.resolve().then(() => __importStar(require('crypto')));
        const otp = randomInt(100000, 1000000).toString();
        // Generate reset token
        const resetToken = (0, uuid_1.v4)();
        // Set expiration (10 minutes)
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10);
        // Delete any existing reset tokens for this user
        await prisma.passwordResetToken.deleteMany({
            where: { userId: user.id },
        });
        // Create new reset token
        await prisma.passwordResetToken.create({
            data: {
                userId: user.id,
                email: user.email,
                otp,
                token: resetToken,
                expiresAt,
            },
        });
        // Send OTP email. Keep the API response generic, but log delivery failures
        // so deployment SMTP issues are visible without exposing account existence.
        const emailSent = await emailService.sendPasswordResetOTP({
            email: user.email,
            otp,
            name: user.name || undefined,
        });
        if (emailSent) {
            logger_1.logger.info('Password reset OTP sent', { userId: user.id, email });
            return;
        }
        logger_1.logger.error('Password reset OTP email was not sent', { userId: user.id, email });
    }
    static async verifyPasswordResetOTP(email, otp) {
        const prisma = (0, database_1.getPrismaClient)();
        // Find user by email
        const user = await prisma.user.findUnique({
            where: { email },
            select: { id: true },
        });
        if (!user) {
            throw new types_1.AuthenticationError('Invalid OTP');
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
            orderBy: { createdAt: 'desc' },
        });
        if (!resetToken) {
            throw new types_1.AuthenticationError('Invalid or expired OTP');
        }
        // Mark as verified
        await prisma.passwordResetToken.update({
            where: { id: resetToken.id },
            data: { verified: true },
        });
        logger_1.logger.info('Password reset OTP verified', { userId: user.id });
        // Return the reset token for password reset
        return resetToken.token;
    }
    static async resetPassword(token, newPassword) {
        const prisma = (0, database_1.getPrismaClient)();
        // Find valid reset token
        const resetToken = await prisma.passwordResetToken.findUnique({
            where: { token },
            include: { user: true },
        });
        if (!resetToken || !resetToken.verified || resetToken.expiresAt < new Date()) {
            throw new types_1.AuthenticationError('Invalid or expired reset token');
        }
        // Hash new password
        const newPasswordHash = await bcryptjs_1.default.hash(newPassword, SALT_ROUNDS);
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
        logger_1.logger.info('Password reset successfully', { userId: resetToken.userId });
    }
}
exports.AuthService = AuthService;
