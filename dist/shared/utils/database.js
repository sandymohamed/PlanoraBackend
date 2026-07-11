"use strict";
// import { PrismaClient } from '@prisma/client';
// import { logger } from './logger';
Object.defineProperty(exports, "__esModule", { value: true });
exports.disconnectDatabase = exports.getPrismaClient = exports.connectDatabase = void 0;
exports.isPrismaConnectionError = isPrismaConnectionError;
exports.ensureDatabaseReady = ensureDatabaseReady;
exports.executeWithRetry = executeWithRetry;
exports.withPrismaRetry = withPrismaRetry;
// let prisma: PrismaClient;
// export const connectDatabase = async (): Promise<void> => {
//   try {
//     prisma = new PrismaClient({
//       log: [
//         { level: 'query', emit: 'event' },
//         { level: 'error', emit: 'stdout' },
//         { level: 'info', emit: 'stdout' },
//         { level: 'warn', emit: 'stdout' },
//       ],
//     });
//     // Log queries in development
//     if (process.env.NODE_ENV === 'development') {
//       prisma.$on('query', (e) => {
//         logger.debug('Query:', {
//           query: e.query,
//           params: e.params,
//           duration: `${e.duration}ms`,
//         });
//       });
//     }
//     await prisma.$connect();
//     logger.info('Database connected successfully');
//   } catch (error) {
//     logger.error('Failed to connect to database:', error);
//     throw error;
//   }
// };
// export const getPrismaClient = (): PrismaClient => {
//   if (!prisma) {
//     throw new Error('Database not connected. Call connectDatabase() first.');
//   }
//   return prisma;
// };
// export const disconnectDatabase = async (): Promise<void> => {
//   if (prisma) {
//     await prisma.$disconnect();
//     logger.info('Database disconnected');
//   }
// };
const client_1 = require("@prisma/client");
const logger_1 = require("./logger");
let prisma;
let reconnectPromise = null;
function isPrismaConnectionError(error) {
    const err = error;
    const message = err?.message ?? '';
    return (err?.code === 'P1017' ||
        err?.code === 'P1001' ||
        err?.code === 'P2037' ||
        err?.code === 'P1008' ||
        message.includes('connection') ||
        message.includes('closed') ||
        message.includes('connection slots') ||
        message.includes('Server has closed the connection') ||
        message.includes('Engine is not yet connected') ||
        (err?.name === 'PrismaClientUnknownRequestError' && message.includes('not yet connected')));
}
async function reconnectDatabaseLocked(maxRetries = 3, retryDelay = 2000) {
    if (reconnectPromise) {
        await reconnectPromise;
        return;
    }
    reconnectPromise = (async () => {
        try {
            if (prisma) {
                try {
                    await prisma.$disconnect();
                }
                catch {
                    // Client may already be disconnected
                }
            }
            prisma = null;
            await (0, exports.connectDatabase)(maxRetries, retryDelay);
        }
        finally {
            reconnectPromise = null;
        }
    })();
    await reconnectPromise;
}
/** Ensure Prisma is connected before background jobs run. Safe to call repeatedly. */
async function ensureDatabaseReady() {
    if (!prisma) {
        await (0, exports.connectDatabase)();
        return;
    }
    try {
        await Promise.race([
            prisma.$queryRaw `SELECT 1`,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Connection test timeout')), 2000)),
        ]);
    }
    catch {
        await reconnectDatabaseLocked();
    }
}
const connectDatabase = async (maxRetries = 5, retryDelay = 5000) => {
    // If prisma client already exists and is connected, don't reconnect
    if (prisma) {
        try {
            // Test if connection is alive with a simple query (use timeout to avoid hanging)
            await Promise.race([
                prisma.$queryRaw `SELECT 1`,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Connection test timeout')), 2000))
            ]);
            logger_1.logger.debug('Database connection is already active, skipping reconnect');
            return;
        }
        catch (testError) {
            // Connection is dead or test timed out, we need to reconnect
            const errorMsg = testError?.message || String(testError);
            logger_1.logger.warn('Database connection test failed, will reconnect:', errorMsg);
            try {
                await prisma.$disconnect();
            }
            catch (disconnectError) {
                // Ignore disconnect errors - client might already be disconnected
            }
            prisma = null; // Clear the dead client
        }
    }
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Parse DATABASE_URL and add connection pool parameters if not present
            let databaseUrl = process.env.DATABASE_URL || '';
            // Add connection pool parameters to prevent "too many connections" errors
            // Using 5 connections (reasonable for a small app) instead of 1
            // PostgreSQL connection pool parameters
            if (databaseUrl && !databaseUrl.includes('connection_limit')) {
                try {
                    const url = new URL(databaseUrl);
                    url.searchParams.set('connection_limit', '5');
                    url.searchParams.set('pool_timeout', '10');
                    databaseUrl = url.toString();
                    logger_1.logger.info('Added connection pool parameters to DATABASE_URL (limit: 5)');
                }
                catch (urlError) {
                    // Fallback if URL parsing fails
                    const separator = databaseUrl.includes('?') ? '&' : '?';
                    databaseUrl = `${databaseUrl}${separator}connection_limit=5&pool_timeout=10`;
                    logger_1.logger.info('Added connection pool parameters to DATABASE_URL (limit: 5, fallback)');
                }
            }
            prisma = new client_1.PrismaClient({
                log: [
                    { level: 'error', emit: 'stdout' },
                    { level: 'warn', emit: 'stdout' },
                    // Removed query and info logs to reduce overhead
                ],
                datasources: {
                    db: {
                        url: databaseUrl,
                    },
                },
            });
            if (process.env.NODE_ENV === 'development') {
                prisma.$on('query', (e) => {
                    logger_1.logger.debug('Query:', {
                        query: e.query,
                        params: e.params,
                        duration: `${e.duration}ms`,
                    });
                });
            }
            await prisma.$connect();
            logger_1.logger.info('Database connected successfully');
            // Note: Prisma Client doesn't have a built-in 'error' event type
            // Connection pool errors are handled automatically by Prisma
            // Error events are caught through try-catch blocks and query execution
            // Successfully connected, exit retry loop
            return;
        }
        catch (error) {
            const isConnectionLimitError = error?.code === 'P2037' ||
                error?.message?.includes('too many database connections') ||
                error?.message?.includes('connection slots');
            if (isConnectionLimitError && attempt < maxRetries) {
                const delay = retryDelay * attempt; // Exponential backoff
                logger_1.logger.warn(`Database connection limit reached (attempt ${attempt}/${maxRetries}), waiting ${delay}ms before retry...`, {
                    error: error.message,
                    code: error.code,
                });
                // Wait before retrying (connections may timeout and free up slots)
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            // If not a connection limit error or max retries reached, throw
            logger_1.logger.error('Failed to connect to database:', error);
            throw error;
        }
    }
};
exports.connectDatabase = connectDatabase;
const getPrismaClient = () => {
    if (!prisma) {
        // Try to connect if not connected
        logger_1.logger.warn('Prisma client not initialized, attempting to connect...');
        // Note: This is synchronous but connectDatabase is async
        // For now, throw error - callers should ensure connectDatabase() is called at startup
        throw new Error('Database not connected. Call connectDatabase() first.');
    }
    // Return the client - connection errors will be handled by executeWithRetry
    // or by Prisma's automatic reconnection (though it's limited)
    return prisma;
};
exports.getPrismaClient = getPrismaClient;
/**
 * Execute a database operation with automatic retry on connection errors
 */
async function executeWithRetry(operation, maxRetries = 3, retryDelay = 1000) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        }
        catch (error) {
            lastError = error;
            if (isPrismaConnectionError(error) && attempt < maxRetries) {
                logger_1.logger.warn(`Database connection error (attempt ${attempt}/${maxRetries}), retrying...`, {
                    error: error.message,
                    code: error.code,
                });
                try {
                    await reconnectDatabaseLocked(3, 2000);
                }
                catch (reconnectError) {
                    logger_1.logger.error('Failed to reconnect to database:', reconnectError);
                }
                await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
                continue;
            }
            // If not a connection error or max retries reached, throw
            throw error;
        }
    }
    throw lastError;
}
/**
 * Run a Prisma operation with retry, always resolving a fresh client on each attempt.
 * Use this instead of closing over getPrismaClient() when parallel jobs may reconnect.
 */
async function withPrismaRetry(operation, maxRetries = 3, retryDelay = 1000) {
    return executeWithRetry(() => operation((0, exports.getPrismaClient)()), maxRetries, retryDelay);
}
const disconnectDatabase = async () => {
    if (prisma) {
        await prisma.$disconnect();
        logger_1.logger.info('Database disconnected');
    }
};
exports.disconnectDatabase = disconnectDatabase;
