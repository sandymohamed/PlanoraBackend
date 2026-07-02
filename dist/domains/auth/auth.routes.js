"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const joi_1 = __importDefault(require("joi"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const auth_service_1 = require("./auth.service");
const logger_1 = require("../../shared/utils/logger");
const types_1 = require("../../shared/types");
const asyncHandler_1 = require("../../shared/middleware/asyncHandler");
const auth_1 = require("../../shared/middleware/auth");
const router = (0, express_1.Router)();
const passwordResetLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { message: 'Too many password reset attempts. Try again later.' } },
});
const verifyOtpLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { message: 'Too many OTP attempts. Try again later.' } },
});
const signupSchema = joi_1.default.object({
    email: joi_1.default.string().email().required(),
    password: joi_1.default.string().min(6).required(),
    name: joi_1.default.string().min(2).max(100).required(),
    timezone: joi_1.default.string().optional(),
});
const loginSchema = joi_1.default.object({
    email: joi_1.default.string().email().required(),
    password: joi_1.default.string().required(),
});
const refreshTokenSchema = joi_1.default.object({
    refreshToken: joi_1.default.string().required(),
});
const optionalRefreshTokenSchema = joi_1.default.object({
    refreshToken: joi_1.default.string().optional(),
});
const changePasswordSchema = joi_1.default.object({
    currentPassword: joi_1.default.string().required(),
    newPassword: joi_1.default.string().min(6).required(),
});
const forgotPasswordSchema = joi_1.default.object({
    email: joi_1.default.string().email().required(),
});
const verifyOTPSchema = joi_1.default.object({
    email: joi_1.default.string().email().required(),
    otp: joi_1.default.string().length(6).pattern(/^\d+$/).required(),
});
const resetPasswordSchema = joi_1.default.object({
    token: joi_1.default.string().uuid().required(),
    newPassword: joi_1.default.string().min(6).required(),
});
// POST /api/v1/auth/signup
router.post('/signup', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    logger_1.logger.info('Signup request', { email: req.body?.email, ip: req.ip });
    const { error, value } = signupSchema.validate(req.body);
    if (error) {
        throw new types_1.ValidationError(error.details[0].message);
    }
    const result = await auth_service_1.AuthService.signup(value);
    res.status(201).json({
        success: true,
        data: result,
        message: 'User created successfully',
    });
}));
// POST /api/v1/auth/login
router.post('/login', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    logger_1.logger.info('Login request', { email: req.body?.email, ip: req.ip });
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
        throw new types_1.ValidationError(error.details[0].message);
    }
    const result = await auth_service_1.AuthService.login(value);
    res.json({
        success: true,
        data: result,
        message: 'Login successful',
    });
}));
// POST /api/v1/auth/refresh
router.post('/refresh', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { error, value } = refreshTokenSchema.validate(req.body);
    if (error) {
        throw new types_1.ValidationError(error.details[0].message);
    }
    const tokens = await auth_service_1.AuthService.refreshToken(value.refreshToken);
    res.json({
        success: true,
        data: tokens,
        message: 'Tokens refreshed successfully',
    });
}));
// POST /api/v1/auth/logout
router.post('/logout', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { error, value } = optionalRefreshTokenSchema.validate(req.body);
    if (error) {
        throw new types_1.ValidationError(error.details[0].message);
    }
    if (value.refreshToken) {
        await auth_service_1.AuthService.logout(value.refreshToken);
    }
    res.json({
        success: true,
        message: 'Logout successful',
    });
}));
// POST /api/v1/auth/logout-all
router.post('/logout-all', auth_1.authenticateToken, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
        throw new types_1.ValidationError('User not authenticated');
    }
    await auth_service_1.AuthService.logoutAll(userId);
    res.json({
        success: true,
        message: 'Logged out from all devices',
    });
}));
// POST /api/v1/auth/change-password
router.post('/change-password', auth_1.authenticateToken, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
        throw new types_1.ValidationError('User not authenticated');
    }
    const { error, value } = changePasswordSchema.validate(req.body);
    if (error) {
        throw new types_1.ValidationError(error.details[0].message);
    }
    await auth_service_1.AuthService.changePassword(userId, value.currentPassword, value.newPassword);
    res.json({
        success: true,
        message: 'Password changed successfully',
    });
}));
// POST /api/v1/auth/forgot-password
router.post('/forgot-password', passwordResetLimiter, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const traceId = `forgot-password-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    logger_1.logger.info('Forgot password step: route started', { traceId, email: req.body?.email, ip: req.ip });
    logger_1.logger.info('Forgot password step: validating request body', { traceId });
    const { error, value } = forgotPasswordSchema.validate(req.body);
    if (error) {
        logger_1.logger.warn('Forgot password step: validation failed', { traceId, error: error.details[0].message });
        throw new types_1.ValidationError(error.details[0].message);
    }
    logger_1.logger.info('Forgot password step: validation passed', { traceId, email: value.email });
    logger_1.logger.info('Forgot password step: calling auth service', { traceId, email: value.email });
    await auth_service_1.AuthService.requestPasswordReset(value.email, traceId);
    logger_1.logger.info('Forgot password step: auth service finished', { traceId, email: value.email });
    logger_1.logger.info('Forgot password step: sending response', { traceId, email: value.email });
    res.json({
        success: true,
        message: 'If an account with that email exists, an OTP has been sent to your email.',
    });
    logger_1.logger.info('Forgot password step: response sent', { traceId, email: value.email });
}));
// POST /api/v1/auth/verify-otp
router.post('/verify-otp', verifyOtpLimiter, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { error, value } = verifyOTPSchema.validate(req.body);
    if (error) {
        throw new types_1.ValidationError(error.details[0].message);
    }
    const token = await auth_service_1.AuthService.verifyPasswordResetOTP(value.email, value.otp);
    res.json({
        success: true,
        data: { token },
        message: 'OTP verified successfully. You can now reset your password.',
    });
}));
// POST /api/v1/auth/reset-password
router.post('/reset-password', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { error, value } = resetPasswordSchema.validate(req.body);
    if (error) {
        throw new types_1.ValidationError(error.details[0].message);
    }
    await auth_service_1.AuthService.resetPassword(value.token, value.newPassword);
    res.json({
        success: true,
        message: 'Password reset successfully. Please login with your new password.',
    });
}));
exports.default = router;
