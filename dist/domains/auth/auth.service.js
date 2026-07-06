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
// auth.services.ts
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uuid_1 = require("uuid");
const database_1 = require("../../shared/utils/database");
const logger_1 = require("../../shared/utils/logger");
const types_1 = require("../../shared/types");
const SALT_ROUNDS = 12;
class AuthService {
    static parseDurationMs(value, fallback) {
        const raw = (value || fallback).trim();
        const match = raw.match(/^(\d+)([smhd])?$/i);
        if (!match) {
            return AuthService.parseDurationMs(fallback, '30d');
        }
        const amount = Number(match[1]);
        const unit = (match[2] || 's').toLowerCase();
        const multipliers = {
            s: 1000,
            m: 60 * 1000,
            h: 60 * 60 * 1000,
            d: 24 * 60 * 60 * 1000,
        };
        return amount * multipliers[unit];
    }
    static accessExpiresInSeconds() {
        return Math.floor(AuthService.parseDurationMs(process.env.JWT_EXPIRES_IN, '15m') / 1000);
    }
    static refreshExpiresAt() {
        return new Date(Date.now() + AuthService.parseDurationMs(process.env.JWT_REFRESH_EXPIRES_IN, '30d'));
    }
    static hashRefreshToken(token) {
        return crypto_1.default.createHash('sha256').update(token).digest('hex');
    }
    static generateTokens(userId, email) {
        const accessToken = jsonwebtoken_1.default.sign({ userId, email }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' });
        const refreshToken = jsonwebtoken_1.default.sign({ userId, email, type: 'refresh', jti: (0, uuid_1.v4)() }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' });
        return {
            accessToken,
            refreshToken,
            expiresIn: AuthService.accessExpiresInSeconds(),
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
                token: AuthService.hashRefreshToken(tokens.refreshToken),
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
                token: AuthService.hashRefreshToken(tokens.refreshToken),
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
            logger_1.logger.warn('Refresh token not found in database', { tokenHash: tokenHash.substring(0, 12) });
            throw new types_1.AuthenticationError('Invalid refresh token');
        }
        // Database expiration is checked before rotation so revoked/expired sessions
        // cannot mint a fresh access token.
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
        // Verify the refresh JWT normally. DB storage lets us revoke sessions; JWT exp
        // remains the cryptographic max lifetime.
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        }
        catch (error) {
            logger_1.logger.warn('Refresh token JWT verification failed', {
                error: error.name,
                message: error.message,
                tokenId: tokenRecord.id
            });
            await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });
            throw new types_1.AuthenticationError('Invalid refresh token');
        }
        if (decoded.type !== 'refresh' || decoded.userId !== tokenRecord.userId) {
            await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });
            throw new types_1.AuthenticationError('Invalid refresh token');
        }
        // Generate new tokens
        const tokens = this.generateTokens(tokenRecord.user.id, tokenRecord.user.email);
        const newRefreshTokenHash = AuthService.hashRefreshToken(tokens.refreshToken);
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
            logger_1.logger.warn('Refresh token rotation race detected', { tokenId: tokenRecord.id, userId: tokenRecord.userId });
            throw new types_1.AuthenticationError('Refresh token already rotated');
        }
        logger_1.logger.info('Tokens refreshed successfully', { userId: tokenRecord.user.id });
        return tokens;
    }
    static async logout(refreshToken) {
        const prisma = (0, database_1.getPrismaClient)();
        // Remove refresh token from database if provided
        if (refreshToken) {
            const tokenHash = AuthService.hashRefreshToken(refreshToken);
            await prisma.refreshToken.deleteMany({
                where: { token: { in: [tokenHash, refreshToken] } },
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
    static async requestPasswordReset(email, traceId) {
        const prisma = (0, database_1.getPrismaClient)();
        console.log('Password reset step: service started', { traceId, email });
        console.log('Password reset step: importing email service', { traceId, email });
        const { emailService } = await Promise.resolve().then(() => __importStar(require('./email.service')));
        console.log('Password reset step: email service imported', {
            traceId,
            email,
            smtpConfigured: emailService.isConfigured(),
        });
        // Find user by email
        console.log('Password reset step: finding user', { traceId, email });
        const user = await prisma.user.findUnique({
            where: { email },
            select: { id: true, email: true, name: true },
        });
        console.log('Password reset step: user lookup finished', {
            traceId,
            email,
            userFound: Boolean(user),
            userId: user?.id,
        });
        // Don't reveal if user exists or not (security best practice)
        if (!user) {
            logger_1.logger.warn('Password reset requested for non-existent email', { traceId, email });
            return; // Silent fail for security
        }
        console.log('Password reset step: generating OTP and reset token', { traceId, email, userId: user.id });
        const { randomInt } = await Promise.resolve().then(() => __importStar(require('crypto')));
        const otp = randomInt(100000, 1000000).toString();
        // Generate reset token
        const resetToken = (0, uuid_1.v4)();
        // Set expiration (10 minutes)
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10);
        // Delete any existing reset tokens for this user
        console.log('Password reset step: deleting existing reset tokens', { traceId, email, userId: user.id });
        await prisma.passwordResetToken.deleteMany({
            where: { userId: user.id },
        });
        console.log('Password reset step: existing reset tokens deleted', { traceId, email, userId: user.id });
        // Create new reset token
        console.log('Password reset step: creating reset token', { traceId, email, userId: user.id });
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
        }
        catch (error) {
            console.error('Password reset step: reset token create failed', {
                traceId,
                email,
                userId: user.id,
                error,
            });
            throw error;
        }
        console.log('Password reset step: reset token created', { traceId, email, userId: user.id });
        // Send OTP email. Keep the API response generic, but log delivery failures
        // so deployment SMTP issues are visible without exposing account existence.
        console.log('Password reset step: sending OTP email', { traceId, email, userId: user.id });
        const emailSent = await emailService.sendPasswordResetOTP({
            email: user.email,
            otp,
            name: user.name || undefined,
        });
        console.log('Password reset step: OTP email send finished', { traceId, email, userId: user.id, emailSent });
        if (emailSent) {
            console.log('Password reset OTP sent', { traceId, userId: user.id, email });
            return;
        }
        console.error('Password reset OTP email was not sent', { traceId, userId: user.id, email });
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
