"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runHealthCheck = runHealthCheck;
const database_1 = require("../../shared/utils/database");
async function runHealthCheck() {
    const checks = {
        database: 'unknown',
        redis: process.env.REDIS_URL ? 'optional' : 'optional',
        firebase: process.env.FIREBASE_PROJECT_ID ? 'optional' : 'not_configured',
    };
    try {
        const prisma = (0, database_1.getPrismaClient)();
        await prisma.$queryRaw `SELECT 1`;
        checks.database = 'ok';
    }
    catch {
        checks.database = 'error';
    }
    let status = 'ok';
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
