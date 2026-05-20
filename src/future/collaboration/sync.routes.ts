import { Router, Response } from 'express';
import Joi from 'joi';
import { getPrismaClient } from '../../shared/utils/database';
import { authenticateToken } from '../../shared/middleware/auth';
import { AuthenticatedRequest, ValidationError, SyncRequest, SyncResponse } from '../../shared/types';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

const syncRequestSchema = Joi.object({
  operations: Joi.array().items(
    Joi.object({
      id: Joi.string().required(),
      entity: Joi.string().required(),
      operation: Joi.string().valid('create', 'update', 'delete').required(),
      data: Joi.object().required(),
      timestamp: Joi.number().required(),
      version: Joi.number().required(),
    })
  ).required(),
  lastSyncTimestamp: Joi.number().required(),
});

// POST /api/v1/sync
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error, value } = syncRequestSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { operations, lastSyncTimestamp } = value as SyncRequest;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Process client operations
    const processedOperations = [];
    const conflicts = [];

    for (const operation of operations) {
      try {
        // Apply operation to database
        const result = await processSyncOperation(prisma, userId, operation);
        processedOperations.push(result);
      } catch (error) {
        // Handle conflicts
        conflicts.push({
          operationId: operation.id,
          // conflictType: 'data',
          conflictType: 'data' as const,   // ✅ narrowed to "data"

          serverData: null,
          clientData: operation.data,
          // resolution: 'manual',
          resolution: 'manual' as const,   // ✅ narrowed to "manual"

        });
      }
    }

    // Get server changes since last sync
    // TODO: Include serverChanges in response when needed
    await getServerChanges(prisma, userId, lastSyncTimestamp);

    const response: SyncResponse = {
      operations: processedOperations,
      conflicts, 
      serverTimestamp: Date.now(),
    };

    return res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    throw error;
  }
});

// GET /api/v1/sync/state
router.get('/state', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Get last server timestamp
    const lastUpdate = await prisma.user.findUnique({
      where: { id: userId },
      select: { updatedAt: true },
    });

    res.json({
      success: true,
      data: {
        lastSyncTimestamp: lastUpdate?.updatedAt.getTime() || 0,
        serverTimestamp: Date.now(),
      },
    });
  } catch (error) {
    throw error;
  }
});

// Helper function to process sync operations
async function processSyncOperation(prisma: any, userId: string, operation: any) {
  const { entity, operation: op, data } = operation;

  switch (entity) {
    case 'task':
      return await processTaskOperation(prisma, userId, op, data);
    case 'project':
      return await processProjectOperation(prisma, userId, op, data);
    case 'goal':
      return await processGoalOperation(prisma, userId, op, data);
    case 'reminder':
      return await processReminderOperation(prisma, userId, op, data);
    case 'alarm':
      return await processAlarmOperation(prisma, userId, op, data);
    default:
      throw new Error(`Unknown entity: ${entity}`);
  }
}

// Helper functions for each entity type
async function processTaskOperation(prisma: any, userId: string, op: string, data: any) {
  switch (op) {
    case 'create':
      return await prisma.task.create({
        data: {
          ...data,
          creatorId: userId,
        },
      });
    case 'update':
      return await prisma.task.update({
        where: { id: data.id },
        data: { ...data, id: undefined },
      });
    case 'delete':
      return await prisma.task.delete({
        where: { id: data.id },
      });
    default:
      throw new Error(`Unknown operation: ${op}`);
  }
}

async function processProjectOperation(prisma: any, userId: string, op: string, data: any) {
  switch (op) {
    case 'create':
      return await prisma.project.create({
        data: {
          ...data,
          ownerId: userId,
        },
      });
    case 'update':
      return await prisma.project.update({
        where: { id: data.id },
        data: { ...data, id: undefined },
      });
    case 'delete':
      return await prisma.project.delete({
        where: { id: data.id },
      });
    default:
      throw new Error(`Unknown operation: ${op}`);
  }
}

async function processGoalOperation(prisma: any, userId: string, op: string, data: any) {
  switch (op) {
    case 'create':
      return await prisma.goal.create({
        data: {
          ...data,
          userId,
        },
      });
    case 'update':
      return await prisma.goal.update({
        where: { id: data.id },
        data: { ...data, id: undefined },
      });
    case 'delete':
      return await prisma.goal.delete({
        where: { id: data.id },
      });
    default:
      throw new Error(`Unknown operation: ${op}`);
  }
}

async function processReminderOperation(prisma: any, userId: string, op: string, data: any) {
  switch (op) {
    case 'create':
      return await prisma.reminder.create({
        data: {
          ...data,
          userId,
        },
      });
    case 'update':
      return await prisma.reminder.update({
        where: { id: data.id },
        data: { ...data, id: undefined },
      });
    case 'delete':
      return await prisma.reminder.delete({
        where: { id: data.id },
      });
    default:
      throw new Error(`Unknown operation: ${op}`);
  }
}

async function processAlarmOperation(prisma: any, userId: string, op: string, data: any) {
  switch (op) {
    case 'create':
      return await prisma.alarm.create({
        data: {
          ...data,
          userId,
        },
      });
    case 'update':
      return await prisma.alarm.update({
        where: { id: data.id },
        data: { ...data, id: undefined },
      });
    case 'delete':
      return await prisma.alarm.delete({
        where: { id: data.id },
      });
    default:
      throw new Error(`Unknown operation: ${op}`);
  }
}

// Helper function to get server changes
async function getServerChanges(prisma: any, userId: string, lastSyncTimestamp: number) {
  const since = new Date(lastSyncTimestamp);

  const [tasks, projects, goals, reminders, alarms] = await Promise.all([
    prisma.task.findMany({
      where: {
        OR: [
          { creatorId: userId },
          { assigneeId: userId },
        ],
        updatedAt: { gt: since },
      },
    }),
    prisma.project.findMany({
      where: {
        OR: [
          { ownerId: userId },
          {
            members: {
              some: { userId },
            },
          },
        ],
        updatedAt: { gt: since },
      },
    }),
    prisma.goal.findMany({
      where: {
        userId,
        updatedAt: { gt: since },
      },
    }),
    prisma.reminder.findMany({
      where: {
        userId,
        createdAt: { gt: since },
      },
    }),
    prisma.alarm.findMany({
      where: {
        userId,
        updatedAt: { gt: since },
      },
    }),
  ]);

  return [
    ...tasks.map((task: any) => ({ entity: 'task', operation: 'update', data: task })),
    ...projects.map((project: any) => ({ entity: 'project', operation: 'update', data: project })),
    ...goals.map((goal: any) => ({ entity: 'goal', operation: 'update', data: goal })),
    ...reminders.map((reminder: any) => ({ entity: 'reminder', operation: 'create', data: reminder })),
    ...alarms.map((alarm: any) => ({ entity: 'alarm', operation: 'update', data: alarm })),
  ];
}

export default router;
