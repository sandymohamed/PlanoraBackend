// import Redis from 'ioredis';
// import { logger } from './logger';

// let redis: Redis;

// export const connectRedis = async (): Promise<void> => {
//   try {
//     redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
//       retryDelayOnFailover: 100,
//       enableReadyCheck: false,
//       maxRetriesPerRequest: null,
//     });

//     redis.on('connect', () => {
//       logger.info('Redis connected successfully');
//     });

//     redis.on('error', (error) => {
//       logger.error('Redis connection error:', error);
//     });

//     redis.on('close', () => {
//       logger.warn('Redis connection closed');
//     });

//     // Test connection
//     await redis.ping();
//   } catch (error) {
//     logger.error('Failed to connect to Redis:', error);
//     throw error;
//   }
// };

// export const getRedisClient = (): Redis => {
//   if (!redis) {
//     throw new Error('Redis not connected. Call connectRedis() first.');
//   }
//   return redis;
// };

// export const disconnectRedis = async (): Promise<void> => {
//   if (redis) {
//     await redis.quit();
//     logger.info('Redis disconnected');
//   }
// };

import Redis from 'ioredis';
import { logger } from './logger';

let redis: Redis;

export const connectRedis = async (): Promise<void> => {
  try {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
    });

    redis.on('connect', () => {
      logger.info('Redis connected successfully');
    });

    redis.on('error', (error) => {
      logger.error('Redis connection error:', error);
    });

    redis.on('close', () => {
      logger.warn('Redis connection closed');
    });

    // Test connection
    await redis.ping();
  } catch (error) {
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
    logger.info('Redis disconnected');
  }
};

