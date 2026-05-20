"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotFoundError = exports.AuthorizationError = exports.AuthenticationError = exports.ConflictError = exports.ValidationError = exports.AppError = void 0;
// Error types
class AppError extends Error {
    constructor(message, statusCode = 500, isOperational = true, code, field) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.code = code;
        this.field = field;
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.AppError = AppError;
// Validation error (invalid input)
class ValidationError extends AppError {
    constructor(message, field) {
        super(message, 400, true, 'VALIDATION_ERROR', field);
    }
}
exports.ValidationError = ValidationError;
// Conflict (e.g. duplicate email)
class ConflictError extends AppError {
    constructor(message, code = 'CONFLICT', field) {
        super(message, 409, true, code, field);
    }
}
exports.ConflictError = ConflictError;
// Authentication error (login, invalid token)
class AuthenticationError extends AppError {
    constructor(message = 'Invalid email or password. Check your credentials or create an account.', code = 'INVALID_CREDENTIALS') {
        super(message, 401, true, code);
    }
}
exports.AuthenticationError = AuthenticationError;
// Authorization error
class AuthorizationError extends AppError {
    constructor(message = 'Insufficient permissions', code = 'FORBIDDEN') {
        super(message, 403, true, code);
    }
}
exports.AuthorizationError = AuthorizationError;
// Not found error
class NotFoundError extends AppError {
    constructor(resource = 'Resource', code = 'NOT_FOUND') {
        super(`${resource} not found`, 404, true, code);
    }
}
exports.NotFoundError = NotFoundError;
