"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.optionalAuth = exports.authenticateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const database_1 = require("../../shared/utils/database");
const types_1 = require("../../shared/types");
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
        if (!token) {
            throw new types_1.AuthenticationError('Access token required');
        }
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        // Decoded token is used below to fetch user
        // Get user from database
        const prisma = (0, database_1.getPrismaClient)();
        const user = await (0, database_1.executeWithRetry)(() => prisma.user.findUnique({
            where: { id: decoded.userId },
            select: {
                id: true,
                email: true,
                name: true,
                timezone: true,
                settings: true,
                createdAt: true,
                updatedAt: true,
            },
        }), 3, 500);
        if (!user) {
            throw new types_1.AuthenticationError('User not found');
        }
        req.user = user;
        next();
    }
    catch (error) {
        if (error instanceof jsonwebtoken_1.default.JsonWebTokenError) {
            next(new types_1.AuthenticationError('Invalid token'));
        }
        else if (error instanceof jsonwebtoken_1.default.TokenExpiredError) {
            next(new types_1.AuthenticationError('Token expired'));
        }
        else {
            next(error);
        }
    }
};
exports.authenticateToken = authenticateToken;
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) {
            return next();
        }
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        const prisma = (0, database_1.getPrismaClient)();
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
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
        if (user) {
            req.user = user;
        }
        next();
    }
    catch (error) {
        // For optional auth, we don't throw errors, just continue without user
        next();
    }
};
exports.optionalAuth = optionalAuth;
