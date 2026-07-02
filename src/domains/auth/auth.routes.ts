import { Router, Request, Response } from 'express';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import { AuthService } from './auth.service';
import { logger } from '../../shared/utils/logger';
import { ValidationError } from '../../shared/types';
import { asyncHandler } from '../../shared/middleware/asyncHandler';
import { authenticateToken } from '../../shared/middleware/auth';

const router = Router();

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many password reset attempts. Try again later.' } },
});

const verifyOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many OTP attempts. Try again later.' } },
});

const signupSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  name: Joi.string().min(2).max(100).required(),
  timezone: Joi.string().optional(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

const optionalRefreshTokenSchema = Joi.object({
  refreshToken: Joi.string().optional(),
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(6).required(),
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
});

const verifyOTPSchema = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.string().length(6).pattern(/^\d+$/).required(),
});

const resetPasswordSchema = Joi.object({
  token: Joi.string().uuid().required(),
  newPassword: Joi.string().min(6).required(),
});

// POST /api/v1/auth/signup
router.post(
  '/signup',
  asyncHandler(async (req: Request, res: Response) => {
    logger.info('Signup request', { email: req.body?.email, ip: req.ip });
    const { error, value } = signupSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const result = await AuthService.signup(value);

    res.status(201).json({
      success: true,
      data: result,
      message: 'User created successfully',
    });
  })
);

// POST /api/v1/auth/login
router.post(
  '/login',
  asyncHandler(async (req: Request, res: Response) => {
    logger.info('Login request', { email: req.body?.email, ip: req.ip });
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const result = await AuthService.login(value);
    res.json({
      success: true,
      data: result,
      message: 'Login successful',
    });
  })
);

// POST /api/v1/auth/refresh
router.post(
  '/refresh',
  asyncHandler(async (req: Request, res: Response) => {
    const { error, value } = refreshTokenSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const tokens = await AuthService.refreshToken(value.refreshToken);

    res.json({
      success: true,
      data: tokens,
      message: 'Tokens refreshed successfully',
    });
  })
);

// POST /api/v1/auth/logout
router.post(
  '/logout',
  asyncHandler(async (req: Request, res: Response) => {
    const { error, value } = optionalRefreshTokenSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    if (value.refreshToken) {
      await AuthService.logout(value.refreshToken);
    }

    res.json({
      success: true,
      message: 'Logout successful',
    });
  })
);

// POST /api/v1/auth/logout-all
router.post(
  '/logout-all',
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      throw new ValidationError('User not authenticated');
    }

    await AuthService.logoutAll(userId);

    res.json({
      success: true,
      message: 'Logged out from all devices',
    });
  })
);

// POST /api/v1/auth/change-password
router.post(
  '/change-password',
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      throw new ValidationError('User not authenticated');
    }

    const { error, value } = changePasswordSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    await AuthService.changePassword(userId, value.currentPassword, value.newPassword);

    res.json({
      success: true,
      message: 'Password changed successfully',
    });
  })
);

// POST /api/v1/auth/forgot-password
router.post(
  '/forgot-password',
  passwordResetLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const traceId = `forgot-password-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    logger.info('Forgot password step: route started', { traceId, email: req.body?.email, ip: req.ip });

    logger.info('Forgot password step: validating request body', { traceId });
    const { error, value } = forgotPasswordSchema.validate(req.body);
    if (error) {
      logger.warn('Forgot password step: validation failed', { traceId, error: error.details[0].message });
      throw new ValidationError(error.details[0].message);
    }
    logger.info('Forgot password step: validation passed', { traceId, email: value.email });

    logger.info('Forgot password step: calling auth service', { traceId, email: value.email });
    await AuthService.requestPasswordReset(value.email, traceId);
    logger.info('Forgot password step: auth service finished', { traceId, email: value.email });

    logger.info('Forgot password step: sending response', { traceId, email: value.email });
    res.json({
      success: true,
      message: 'If an account with that email exists, an OTP has been sent to your email.',
    });
    logger.info('Forgot password step: response sent', { traceId, email: value.email });
  })
);

// POST /api/v1/auth/verify-otp
router.post(
  '/verify-otp',
  verifyOtpLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { error, value } = verifyOTPSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const token = await AuthService.verifyPasswordResetOTP(value.email, value.otp);

    res.json({
      success: true,
      data: { token },
      message: 'OTP verified successfully. You can now reset your password.',
    });
  })
);

// POST /api/v1/auth/reset-password
router.post(
  '/reset-password',
  asyncHandler(async (req: Request, res: Response) => {
    const { error, value } = resetPasswordSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    await AuthService.resetPassword(value.token, value.newPassword);

    res.json({
      success: true,
      message: 'Password reset successfully. Please login with your new password.',
    });
  })
);

export default router;
