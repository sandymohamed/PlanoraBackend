"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = void 0;
const logger_1 = require("../../shared/utils/logger");
const types_1 = require("../../shared/types");
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const errorHandler = (error, req, res, _next) => {
    let statusCode = 500;
    let message = 'Internal server error';
    let code;
    let field;
    if (error instanceof types_1.AppError) {
        statusCode = error.statusCode;
        message = error.message;
        code = error.code;
        field = error.field;
    }
    else if (error.name === 'ValidationError') {
        statusCode = 400;
        message = error.message;
        code = 'VALIDATION_ERROR';
    }
    else if (error.name === 'JsonWebTokenError') {
        statusCode = 401;
        message = 'Invalid token';
        code = 'INVALID_TOKEN';
    }
    else if (error.name === 'TokenExpiredError') {
        statusCode = 401;
        message = 'Token expired';
        code = 'TOKEN_EXPIRED';
    }
    else if (error.name === 'PrismaClientKnownRequestError') {
        statusCode = 400;
        message = 'Database operation failed';
        code = 'DATABASE_ERROR';
    }
    if (statusCode >= 500) {
        logger_1.logger.error('Server error:', {
            error: error.message,
            stack: error.stack,
            url: req.url,
            method: req.method,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
        });
    }
    else {
        logger_1.logger.warn('Client error:', {
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
exports.errorHandler = errorHandler;
