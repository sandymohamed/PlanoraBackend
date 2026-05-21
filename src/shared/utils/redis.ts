import Redis, { RedisOptions } from 'ioredis';
import { logger } from './logger';

let redis: Redis | null = null;

/**
 * Aiven / cloud Redis uses rediss:// with a cert chain Node may not trust on Windows (corporate proxy, missing CA).
 * - Development: verify certs only if REDIS_TLS_REJECT_UNAUTHORIZED=true
 * - Production: verify by default; set REDIS_TLS_REJECT_UNAUTHORIZED=false only if you supply a custom CA
 */
function buildRedisOptions(): RedisOptions {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  const isTls = url.startsWith('rediss://') || process.env.REDIS_TLS === 'true';

  const rejectUnauthorized =
    process.env.REDIS_TLS_REJECT_UNAUTHORIZED === 'true'
      ? true
      : process.env.REDIS_TLS_REJECT_UNAUTHORIZED === 'false'
        ? false
        : process.env.NODE_ENV === 'production';

  const options: RedisOptions = {
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      if (times > 12) {
        logger.warn('Redis: stopping reconnect after 12 attempts');
        return null;
      }
      return Math.min(times * 400, 8000);
    },
  };

  if (isTls) {
    options.tls = { rejectUnauthorized };
    if (!rejectUnauthorized) {
      logger.warn(
        'Redis TLS: certificate verification disabled. For production use Aiven CA + REDIS_TLS_REJECT_UNAUTHORIZED=true'
      );
    }
  }

  return options;
}

export const connectRedis = async (): Promise<void> => {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';

  try {
    redis = new Redis(url, buildRedisOptions());

    redis.on('connect', () => {
      logger.info('Redis connected successfully');
    });

    redis.on('error', (error) => {
      logger.error('Redis connection error:', error);
    });

    redis.on('close', () => {
      logger.warn('Redis connection closed');
    });

    await redis.ping();
  } catch (error) {
    if (redis) {
      redis.disconnect(false);
      redis = null;
    }
    logger.error('Failed to connect to Redis:', error);
    throw error;
  }
};

export const getRedisClient = (): Redis => {
  if (!redis) {
    throw new Error('Redis not connected. Call connectRedis() first.');
  }
  return redis;
};

export const disconnectRedis = async (): Promise<void> => {
  if (redis) {
    await redis.quit();
    redis = null;
    logger.info('Redis disconnected');
  }
};
