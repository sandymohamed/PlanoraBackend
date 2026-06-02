import { getPrismaClient } from '../../shared/utils/database';

export type HealthStatus = {
  status: 'ok' | 'degraded' | 'error';
  product: string;
  timestamp: string;
  checks: {
    database: 'ok' | 'error' | 'unknown';
    redis: 'ok' | 'optional' | 'error';
    firebase: 'ok' | 'optional' | 'not_configured';
  };
};

export async function runHealthCheck(): Promise<HealthStatus> {
  const checks: HealthStatus['checks'] = {
    database: 'unknown',
    redis: process.env.REDIS_URL ? 'optional' : 'optional',
    firebase: process.env.FIREBASE_PROJECT_ID ? 'optional' : 'not_configured',
  };

  try {
    const prisma = getPrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  let status: HealthStatus['status'] = 'ok';
  if (checks.database === 'error') {
    status = 'error';
  }

  return {
    status,
    product: 'Planora AI',
    timestamp: new Date().toISOString(),
    checks,
  };
}
