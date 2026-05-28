import { Request, Response, NextFunction } from 'express';
import { logger } from '../../shared/utils/logger';
import { AppError } from '../../shared/types';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  let statusCode = 500;
  let message = 'Internal server error';
  let code: string | undefined;
  let field: string | undefined;

  if (error instanceof AppError) {
    statusCode = error.statusCode;
    message = error.message;
    code = error.code;
    field = error.field;
  } else if (error.name === 'ValidationError') {
    statusCode = 400;
    message = error.message;
    code = 'VALIDATION_ERROR';
  } else if (error.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
    code = 'INVALID_TOKEN';
  } else if (error.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
    code = 'TOKEN_EXPIRED';
  } else if (error.name === 'PrismaClientKnownRequestError') {
    const prismaCode = (error as { code?: string }).code;
    const isUnavailable =
      prismaCode === 'P1001' ||
      prismaCode === 'P1002' ||
      prismaCode === 'P1017' ||
      (error.message && error.message.includes("Can't reach database server"));
    statusCode = isUnavailable ? 503 : 400;
    message = isUnavailable ? 'Database temporarily unavailable' : 'Database operation failed';
    code = isUnavailable ? 'SERVICE_UNAVAILABLE' : 'DATABASE_ERROR';
  }

  if (statusCode >= 500) {
    logger.error('Server error:', {
      error: error.message,
      stack: error.stack,
      url: req.url,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });
  } else {
    logger.warn('Client error:', {
      error: error.message,
      code,
      field,
      url: req.url,
      method: req.method,
      ip: req.ip,
      statusCode,
    });
  }

  res.status(statusCode).json({
    success: false,
    error: message,
    message,
    ...(code && { code }),
    ...(field && { field }),
    ...(process.env.NODE_ENV === 'development' &&
      statusCode >= 500 && {
        stack: error.stack,
        details: error.message,
      }),
  });
};
