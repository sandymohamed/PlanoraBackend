"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.disconnectRedis = exports.getRedisClient = exports.connectRedis = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const logger_1 = require("./logger");
let redis = null;
/**
 * Aiven / cloud Redis uses rediss:// with a cert chain Node may not trust on Windows (corporate proxy, missing CA).
 * - Development: verify certs only if REDIS_TLS_REJECT_UNAUTHORIZED=true
 * - Production: verify by default; set REDIS_TLS_REJECT_UNAUTHORIZED=false only if you supply a custom CA
 */
function buildRedisOptions() {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    const isTls = url.startsWith('rediss://') || process.env.REDIS_TLS === 'true';
    const rejectUnauthorized = process.env.REDIS_TLS_REJECT_UNAUTHORIZED === 'true'
        ? true
        : process.env.REDIS_TLS_REJECT_UNAUTHORIZED === 'false'
            ? false
            : process.env.NODE_ENV === 'production';
    const options = {
        enableReadyCheck: false,
        maxRetriesPerRequest: null,
        retryStrategy(times) {
            if (times > 12) {
                logger_1.logger.warn('Redis: stopping reconnect after 12 attempts');
                return null;
            }
            return Math.min(times * 400, 8000);
        },
    };
    if (isTls) {
        options.tls = { rejectUnauthorized };
        if (!rejectUnauthorized) {
            logger_1.logger.warn('Redis TLS: certificate verification disabled. For production use Aiven CA + REDIS_TLS_REJECT_UNAUTHORIZED=true');
        }
    }
    return options;
}
const connectRedis = async () => {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    try {
        redis = new ioredis_1.default(url, buildRedisOptions());
        redis.on('connect', () => {
            logger_1.logger.info('Redis connected successfully');
        });
        redis.on('error', (error) => {
            logger_1.logger.error('Redis connection error:', error);
        });
        redis.on('close', () => {
            logger_1.logger.warn('Redis connection closed');
        });
        await redis.ping();
    }
    catch (error) {
        if (redis) {
            redis.disconnect(false);
            redis = null;
        }
        logger_1.logger.error('Failed to connect to Redis:', error);
        throw error;
    }
};
exports.connectRedis = connectRedis;
const getRedisClient = () => {
    if (!redis) {
        throw new Error('Redis not connected. Call connectRedis() first.');
    }
    return redis;
};
exports.getRedisClient = getRedisClient;
const disconnectRedis = async () => {
    if (redis) {
        await redis.quit();
        redis = null;
        logger_1.logger.info('Redis disconnected');
    }
};
exports.disconnectRedis = disconnectRedis;
