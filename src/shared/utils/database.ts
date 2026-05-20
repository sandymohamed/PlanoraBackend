// import { PrismaClient } from '@prisma/client';
// import { logger } from './logger';

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


import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from './logger';

let prisma: PrismaClient;

export const connectDatabase = async (maxRetries: number = 5, retryDelay: number = 5000): Promise<void> => {
  // If prisma client already exists and is connected, don't reconnect
  if (prisma) {
    try {
      // Test if connection is alive with a simple query (use timeout to avoid hanging)
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection test timeout')), 2000))
      ]);
      logger.debug('Database connection is already active, skipping reconnect');
      return;
    } catch (testError: any) {
      // Connection is dead or test timed out, we need to reconnect
      const errorMsg = testError?.message || String(testError);
      logger.warn('Database connection test failed, will reconnect:', errorMsg);
      try {
        await prisma.$disconnect();
      } catch (disconnectError) {
        // Ignore disconnect errors - client might already be disconnected
      }
      prisma = null as any; // Clear the dead client
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
        logger.info('Added connection pool parameters to DATABASE_URL (limit: 5)');
      } catch (urlError) {
        // Fallback if URL parsing fails
        const separator = databaseUrl.includes('?') ? '&' : '?';
        databaseUrl = `${databaseUrl}${separator}connection_limit=5&pool_timeout=10`;
        logger.info('Added connection pool parameters to DATABASE_URL (limit: 5, fallback)');
      }
    }

    prisma = new PrismaClient({
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
      (prisma.$on as any)('query', (e: Prisma.QueryEvent) => {
        logger.debug('Query:', {
          query: e.query,
          params: e.params,
          duration: `${e.duration}ms`,
        });
      });
    }

    await prisma.$connect();
    logger.info('Database connected successfully');
    
      // Note: Prisma Client doesn't have a built-in 'error' event type
      // Connection pool errors are handled automatically by Prisma
      // Error events are caught through try-catch blocks and query execution
      
      // Successfully connected, exit retry loop
      return;
    } catch (error: any) {
      const isConnectionLimitError = 
        error?.code === 'P2037' || 
        error?.message?.includes('too many database connections') ||
        error?.message?.includes('connection slots');
      
      if (isConnectionLimitError && attempt < maxRetries) {
        const delay = retryDelay * attempt; // Exponential backoff
        logger.warn(`Database connection limit reached (attempt ${attempt}/${maxRetries}), waiting ${delay}ms before retry...`, {
          error: error.message,
          code: error.code,
        });
        
        // Wait before retrying (connections may timeout and free up slots)
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // If not a connection limit error or max retries reached, throw
    logger.error('Failed to connect to database:', error);
    throw error;
    }
  }
};

export const getPrismaClient = (): PrismaClient => {
  if (!prisma) {
    // Try to connect if not connected
    logger.warn('Prisma client not initialized, attempting to connect...');
    // Note: This is synchronous but connectDatabase is async
    // For now, throw error - callers should ensure connectDatabase() is called at startup
    throw new Error('Database not connected. Call connectDatabase() first.');
  }
  
  // Return the client - connection errors will be handled by executeWithRetry
  // or by Prisma's automatic reconnection (though it's limited)
  return prisma;
};

/**
 * Execute a database operation with automatic retry on connection errors
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a connection error
      const isConnectionError = 
        error?.code === 'P1017' || // Server has closed the connection
        error?.code === 'P1001' || // Can't reach database server
        error?.code === 'P2037' || // Too many database connections
        error?.code === 'P1008' || // Operations timed out
        error?.message?.includes('connection') ||
        error?.message?.includes('closed') ||
        error?.message?.includes('connection slots') ||
        error?.message?.includes('Server has closed the connection');
      
      if (isConnectionError && attempt < maxRetries) {
        logger.warn(`Database connection error (attempt ${attempt}/${maxRetries}), retrying...`, {
          error: error.message,
          code: error.code,
        });
        
        // Try to reconnect - disconnect first if client exists
        try {
          if (prisma) {
            try {
              await prisma.$disconnect();
            } catch (disconnectError) {
              // Ignore disconnect errors - client might already be disconnected
              logger.debug('Error disconnecting (expected if already disconnected):', disconnectError);
            }
          }
          // Clear the client reference
          prisma = null as any;
          // Reconnect with fewer retries and shorter delay
          await connectDatabase(3, 2000);
        } catch (reconnectError) {
          logger.error('Failed to reconnect to database:', reconnectError);
          // Continue to retry the operation anyway - might work if connection was restored
        }
        
        // Wait before retrying with exponential backoff
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        continue;
      }
      
      // If not a connection error or max retries reached, throw
      throw error;
    }
  }
  
  throw lastError;
}

export const disconnectDatabase = async (): Promise<void> => {
  if (prisma) {
    await prisma.$disconnect();
    logger.info('Database disconnected');
  }
};
