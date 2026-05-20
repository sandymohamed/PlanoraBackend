import { Router, Response } from 'express';
import Joi from 'joi';
import { getPrismaClient } from '../../shared/utils/database';
import { authenticateToken } from '../../shared/middleware/auth';
import { AuthenticatedRequest, ValidationError, NotFoundError, AuthorizationError } from '../../shared/types';
import { logger } from '../../shared/utils/logger';
import { Prisma } from '@prisma/client';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Helper function to map project data from backend to frontend format
const mapProjectToFrontend = (project: any) => {
  return {
    ...project,
    name: project.title, // Map title to name for frontend
    status: project.status || 'PLANNING', // Add default status
    members: project.members?.map((member: any) => ({
      id: member.id,
      userId: member.userId,
      userName: member.user?.name || '',
      userEmail: member.user?.email || '',
      role: member.role,
      joinedAt: member.createdAt,
    })) || [],
    isDeleted: false, // Add default value
    syncedAt: project.updatedAt,
  };
};

const createProjectSchema = Joi.object({
  name: Joi.string().min(1).max(255).required(),
  description: Joi.string().max(1000).allow('').optional(),
  color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
  startDate: Joi.date().allow(null).optional(),
  endDate: Joi.date().allow(null).optional(),
  isPublic: Joi.boolean().optional(),
});

const updateProjectSchema = Joi.object({
  name: Joi.string().min(1).max(255).optional(),
  description: Joi.string().max(1000).allow('').optional(),
  color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
  startDate: Joi.date().allow(null).optional(),
  endDate: Joi.date().allow(null).optional(),
  isPublic: Joi.boolean().optional(),
});

const addMemberSchema = Joi.object({
  email: Joi.string().email().required(),
  role: Joi.string().valid('EDITOR', 'VIEWER').required(),
});

// GET /api/v1/projects
// router.get('/', async (req: AuthenticatedRequest, res: Response) => {
//   try {
//     const { page = 1, limit = 20, search } = req.query;
//     const userId = req.user!.id;
//     const prisma = getPrismaClient();

//     const where = {
//       OR: [
//         { ownerId: userId },
//         { members: { some: { userId } } },
//       ],
//       ...(search ? {
//         OR: [
//           { title: { contains: search as string, mode: 'insensitive' } },
//           { description: { contains: search as string, mode: 'insensitive' } },
//         ],
//       } : {}),
//     };

//     const [projects, total] = await Promise.all([
//       prisma.project.findMany({
//         where,
//         include: {
//           owner: {
//             select: { id: true, name: true, email: true },
//           },
//           members: {
//             include: {
//               user: {
//                 select: { id: true, name: true, email: true },
//               },
//             },
//           },
//           _count: {
//             select: { tasks: true },
//           },
//         },
//         orderBy: { updatedAt: 'desc' },
//         skip: (Number(page) - 1) * Number(limit),
//         take: Number(limit),
//       }),
//       prisma.project.count({ where }),
//     ]);

//     res.json({
//       success: true,
//       data: projects,
//       pagination: {
//         page: Number(page),
//         limit: Number(limit),
//         total,
//         totalPages: Math.ceil(total / Number(limit)),
//       },
//     });
//   } catch (error) {
//     logger.error('Failed to get projects:', error);
//     throw error;
//   }
// });
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const where: Prisma.ProjectWhereInput = {
      AND: [
        {
          OR: [
            { ownerId: userId },
            { members: { some: { userId } } },
          ],
        },
        ...(search
          ? [
            {
              OR: [
                {
                  title: {
                    contains: search as string,
                    mode: Prisma.QueryMode.insensitive,
                  },
                },
                {
                  description: {
                    contains: search as string,
                    mode: Prisma.QueryMode.insensitive,
                  },
                },
              ],
            },
          ]
          : []),
      ],
    };

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        include: {
          owner: { select: { id: true, name: true, email: true } },
          members: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
          _count: { select: { tasks: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.project.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        data: projects.map(mapProjectToFrontend),
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    logger.error('Failed to get projects:', error);
    throw error;
  }
});

// GET /api/v1/projects/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const project = await prisma.project.findFirst({
      where: {
        id,
        OR: [
          { ownerId: userId },
          { members: { some: { userId } } },
        ],
      },
      include: {
        owner: {
          select: { id: true, name: true, email: true },
        },
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        tasks: {
          include: {
            creator: {
              select: { id: true, name: true, email: true },
            },
            assignee: {
              select: { id: true, name: true, email: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { tasks: true },
        },
      },
    });

    if (!project) {
      throw new NotFoundError('Project');
    }

    res.json({
      success: true,
      data: mapProjectToFrontend(project),
    });
  } catch (error) {
    logger.error('Failed to get project:', error);
    throw error;
  }
});

// POST /api/v1/projects
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error, value } = createProjectSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const project = await prisma.project.create({
      data: {
        title: value.name, // Map name to title
        description: value.description,
        color: value.color,
        startDate: value.startDate,
        endDate: value.endDate,
        isPublic: value.isPublic,
        ownerId: userId,
      },
      include: {
        owner: {
          select: { id: true, name: true, email: true },
        },
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        _count: {
          select: { tasks: true },
        },
      },
    });

    // Add owner as member
    await prisma.projectMember.create({
      data: {
        projectId: project.id,
        userId: userId,
        role: 'OWNER',
      },
    });

    logger.info('Project created successfully', { projectId: project.id, userId });

    res.status(201).json({
      success: true,
      data: mapProjectToFrontend(project),
      message: 'Project created successfully',
    });
  } catch (error) {
    logger.error('Failed to create project:', error);
    throw error;
  }
});

// PUT /api/v1/projects/:id
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { error, value } = updateProjectSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Check if user is owner or editor
    const project = await prisma.project.findFirst({
      where: {
        id,
        OR: [
          { ownerId: userId },
          { members: { some: { userId, role: { in: ['OWNER', 'EDITOR'] } } } },
        ],
      },
    });

    if (!project) {
      throw new NotFoundError('Project');
    }

    // Prepare update data, mapping name to title
    const updateData: any = {};
    if (value.name !== undefined) updateData.title = value.name;
    if (value.description !== undefined) updateData.description = value.description;
    if (value.color !== undefined) updateData.color = value.color;
    if (value.startDate !== undefined) updateData.startDate = value.startDate;
    if (value.endDate !== undefined) updateData.endDate = value.endDate;
    if (value.isPublic !== undefined) updateData.isPublic = value.isPublic;

    const updatedProject = await prisma.project.update({
      where: { id },
      data: updateData,
      include: {
        owner: {
          select: { id: true, name: true, email: true },
        },
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        _count: {
          select: { tasks: true },
        },
      },
    });

    logger.info('Project updated successfully', { projectId: id, userId });

    res.json({
      success: true,
      data: mapProjectToFrontend(updatedProject),
      message: 'Project updated successfully',
    });
  } catch (error) {
    logger.error('Failed to update project:', error);
    throw error;
  }
});

// DELETE /api/v1/projects/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Check if user is owner
    const project = await prisma.project.findFirst({
      where: { id, ownerId: userId },
    });

    if (!project) {
      throw new NotFoundError('Project');
    }

    await prisma.project.delete({
      where: { id },
    });

    logger.info('Project deleted successfully', { projectId: id, userId });

    res.json({
      success: true,
      message: 'Project deleted successfully',
    });
  } catch (error) {
    logger.error('Failed to delete project:', error);
    throw error;
  }
});

// POST /api/v1/projects/:id/members
router.post('/:id/members', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { error, value } = addMemberSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Check if user is owner or editor
    const project = await prisma.project.findFirst({
      where: {
        id,
        OR: [
          { ownerId: userId },
          { members: { some: { userId, role: { in: ['OWNER', 'EDITOR'] } } } },
        ],
      },
    });

    if (!project) {
      throw new NotFoundError('Project');
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: value.email },
    });

    if (!user) {
      throw new NotFoundError('User');
    }

    // Check if user is already a member
    const existingMember = await prisma.projectMember.findFirst({
      where: {
        projectId: id,
        userId: user.id,
      },
    });

    if (existingMember) {
      throw new ValidationError('User is already a member of this project');
    }

    const member = await prisma.projectMember.create({
      data: {
        projectId: id,
        userId: user.id,
        role: value.role,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    logger.info('Member added to project', { projectId: id, memberId: user.id, userId });

    res.status(201).json({
      success: true,
      data: member,
      message: 'Member added successfully',
    });
  } catch (error) {
    logger.error('Failed to add member:', error);
    throw error;
  }
});

// PUT /api/v1/projects/:id/members/:memberId
router.put('/:id/members/:memberId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, memberId } = req.params;
    const { role } = req.body;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Check if user is owner
    const project = await prisma.project.findFirst({
      where: { id, ownerId: userId },
    });

    if (!project) {
      throw new AuthorizationError('Only project owners can change member roles');
    }

    const member = await prisma.projectMember.update({
      where: {
        id: memberId,
        projectId: id,
      },
      data: { role },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    logger.info('Member role updated', { projectId: id, memberId, userId });

    res.json({
      success: true,
      data: member,
      message: 'Member role updated successfully',
    });
  } catch (error) {
    logger.error('Failed to update member role:', error);
    throw error;
  }
});

// DELETE /api/v1/projects/:id/members/:memberId
router.delete('/:id/members/:memberId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, memberId } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Check if user is owner or the member themselves
    const project = await prisma.project.findFirst({
      where: { id, ownerId: userId },
    });

    const member = await prisma.projectMember.findFirst({
      where: {
        id: memberId,
        projectId: id,
      },
    });

    if (!member) {
      throw new NotFoundError('Member');
    }

    if (!project && member.userId !== userId) {
      throw new AuthorizationError('Only project owners can remove members');
    }

    await prisma.projectMember.delete({
      where: { id: memberId },
    });

    logger.info('Member removed from project', { projectId: id, memberId, userId });

    res.json({
      success: true,
      message: 'Member removed successfully',
    });
  } catch (error) {
    logger.error('Failed to remove member:', error);
    throw error;
  }
});

export default router;