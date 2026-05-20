import { Router, Response } from 'express';
import Joi from 'joi';
import { getPrismaClient } from '../../shared/utils/database';
import { authenticateToken } from '../../shared/middleware/auth';
import { AuthenticatedRequest, ValidationError, NotFoundError, AuthorizationError } from '../../shared/types';
import { logger } from '../../shared/utils/logger';
import { invitationService } from '../services/invitationService';
import { ProjectInvitationStatus } from '@prisma/client';

const router = Router();

// Apply authentication to all routes except public invitation endpoints
router.use((req, res, next) => {
  // Skip authentication for invitation acceptance/decline endpoints
  if (req.path.includes('/accept/') || req.path.includes('/decline/')) {
    return next();
  }
  return authenticateToken(req, res, next);
});

const createInvitationSchema = Joi.object({
  projectId: Joi.string().required(),
  email: Joi.string().email().required(),
  role: Joi.string().valid('OWNER', 'EDITOR', 'VIEWER').required(),
});

// POST /api/v1/invitations
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error, value } = createInvitationSchema.validate(req.body);
    
    // console.log('value', value);
    // console.log('error', error);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }
    
    const { projectId } = value;
    // console.log('projectId', projectId);
    
    const userId = req.user!.id;
    // console.log('userId', userId);
    const prisma = getPrismaClient();
    // console.log('prisma', prisma);
    
    // Check if user has permission to invite (owner or editor)
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: userId },
          { members: { some: { userId, role: { in: ['OWNER', 'EDITOR'] } } } },
        ],
      },
    });
        // console.log('project', project);
        
        if (!project) {
          throw new AuthorizationError('You do not have permission to invite members to this project');
    }

    const invitation = await invitationService.createInvitation({
      projectId: value.projectId,
      email: value.email,
      role: value.role,
      invitedBy: userId,
    });
    // console.log('invitation', invitation);

    logger.info('Invitation created', { invitationId: invitation.id, projectId: value.projectId, invitedBy: userId });

    res.status(201).json({
      success: true,
      data: invitation,
      message: 'Invitation sent successfully',
    });
  } catch (error) {
    logger.error('Failed to create invitation:', error);
    throw error;
  }
});

// GET /api/v1/invitations/project/:projectId
router.get('/project/:projectId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Check if user has permission to view invitations
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: userId },
          { members: { some: { userId, role: { in: ['OWNER', 'EDITOR'] } } } },
        ],
      },
    });

    if (!project) {
      throw new AuthorizationError('You do not have permission to view invitations for this project');
    }

    const invitations = await invitationService.getProjectInvitations(projectId);

    res.json({
      success: true,
      data: invitations,
    });
  } catch (error) {
    logger.error('Failed to get project invitations:', error);
    throw error;
  }
});

// PUT /api/v1/invitations/:invitationId/accept
router.put('/:invitationId/accept', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { invitationId } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Get the invitation
    const invitation = await prisma.projectInvitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation) {
      return res.status(404).json({
        success: false,
        message: 'Invitation not found',
      });
    }

    // Accept the invitation
    await prisma.projectInvitation.update({
      where: { id: invitationId },
      data: {
        status: ProjectInvitationStatus.ACCEPTED,
        respondedAt: new Date(),
      },
    });

    // Add user to project members
    await prisma.projectMember.create({
      data: {
        projectId: invitation.projectId,
        userId: userId,
        role: invitation.role,
      },
    });

    return res.json({
      success: true,
      message: 'Invitation accepted successfully',
    });
  } catch (error) {
    logger.error('Failed to accept invitation:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to accept invitation',
    });
  }
});

// PUT /api/v1/invitations/:invitationId/decline
router.put('/:invitationId/decline', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { invitationId } = req.params;
    const prisma = getPrismaClient();

    // Get the invitation
    const invitation = await prisma.projectInvitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation) {
      return res.status(404).json({
        success: false,
        message: 'Invitation not found',
      });
    }

    // Decline the invitation
    await prisma.projectInvitation.update({
      where: { id: invitationId },
      data: {
        status: ProjectInvitationStatus.DECLINED,
        respondedAt: new Date(),
      },
    });

    return res.json({
      success: true,
      message: 'Invitation declined successfully',
    });
  } catch (error) {
    logger.error('Failed to decline invitation:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to decline invitation',
    });
  }
});

// POST /api/v1/invitations/:invitationId/resend
router.post('/:invitationId/resend', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { invitationId } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Get the invitation
    const invitation = await prisma.projectInvitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation) {
      return res.status(404).json({
        success: false,
        message: 'Invitation not found',
      });
    }

    // Check if user has permission to resend (must be the sender)
    if (invitation.invitedBy !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to resend this invitation',
      });
    }

    // Update the expiration date (extend by 7 days)
    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + 7);

    await prisma.projectInvitation.update({
      where: { id: invitationId },
      data: {
        status: ProjectInvitationStatus.PENDING,
        expiresAt: newExpiresAt,
        respondedAt: null,
      },
    });

    // TODO: Send email notification
    // await emailService.sendProjectInvitation(email, project.title, token);

    return res.json({
      success: true,
      message: 'Invitation resent successfully',
    });
  } catch (error) {
    logger.error('Failed to resend invitation:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to resend invitation',
    });
  }
});

// GET /api/v1/invitations/:token
router.get('/:token', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { token } = req.params;
    const invitation = await invitationService.getInvitationByToken(token);

    if (!invitation) {
      throw new NotFoundError('Invitation');
    }

    res.json({
      success: true,
      data: invitation,
    });
  } catch (error) {
    logger.error('Failed to get invitation:', error);
    throw error;
  }
});

// POST /api/v1/invitations/:token/accept
router.post('/:token/accept', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { token } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to accept invitation',
      });
    }

    const result = await invitationService.acceptInvitation(token, userId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }

    return res.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    logger.error('Failed to accept invitation:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to accept invitation',
    });
  }
});

// POST /api/v1/invitations/:token/decline
router.post('/:token/decline', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { token } = req.params;
    const result = await invitationService.declineInvitation(token);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }

    return res.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    logger.error('Failed to decline invitation:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to decline invitation',
    });
  }
});

// DELETE /api/v1/invitations/:invitationId
router.delete('/:invitationId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { invitationId } = req.params;
    const userId = req.user!.id;

    const result = await invitationService.cancelInvitation(invitationId, userId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }

    return res.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    logger.error('Failed to cancel invitation:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to cancel invitation',
    });
  }
});

// GET /api/v1/invitations/user/pending
router.get('/user/pending', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Get pending invitations for the user's email
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user) {
      throw new NotFoundError('User');
    }

    const invitations = await prisma.projectInvitation.findMany({
      where: {
        email: user.email,
        status: ProjectInvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      include: {
        project: {
          select: {
            id: true,
            title: true,
            description: true,
          },
        },
        inviter: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const mappedInvitations = invitations.map(invitation => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      invitedAt: invitation.invitedAt.toISOString(),
      expiresAt: invitation.expiresAt.toISOString(),
      project: {
        id: invitation.project.id,
        name: invitation.project.title,
        description: invitation.project.description,
      },
      inviter: {
        id: invitation.inviter.id,
        name: invitation.inviter.name || invitation.inviter.email,
        email: invitation.inviter.email,
      },
    }));

    res.json({
      success: true,
      data: mappedInvitations,
    });
  } catch (error) {
    logger.error('Failed to get pending invitations:', error);
    throw error;
  }
});

// GET /api/v1/invitations/user/sent
router.get('/user/sent', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Get all invitations sent by the user
    const invitations = await prisma.projectInvitation.findMany({
      where: {
        invitedBy: userId,
      },
      include: {
        project: {
          select: {
            id: true,
            title: true,
            description: true,
          },
        },
        inviter: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const mappedInvitations = invitations.map(invitation => ({
      id: invitation.id,
      projectId: invitation.projectId,
      projectName: invitation.project.title,
      inviterId: invitation.invitedBy,
      inviterName: invitation.inviter.name || invitation.inviter.email,
      inviteeEmail: invitation.email,
      role: invitation.role,
      status: invitation.status,
      createdAt: invitation.invitedAt.toISOString(),
      expiresAt: invitation.expiresAt.toISOString(),
      acceptedAt: invitation.respondedAt?.toISOString(),
    }));

    res.json({
      success: true,
      data: mappedInvitations,
    });
  } catch (error) {
    logger.error('Failed to get sent invitations:', error);
    throw error;
  }
});

// GET /api/v1/invitations/user/all
router.get('/user/all', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Get user's email
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user) {
      throw new NotFoundError('User');
    }

    // Get all invitations where user is the invitee (received invitations)
    const receivedInvitations = await prisma.projectInvitation.findMany({
      where: {
        email: user.email,
      },
      include: {
        project: {
          select: {
            id: true,
            title: true,
            description: true,
          },
        },
        inviter: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get all invitations sent by the user
    const sentInvitations = await prisma.projectInvitation.findMany({
      where: {
        invitedBy: userId,
      },
      include: {
        project: {
          select: {
            id: true,
            title: true,
            description: true,
          },
        },
        inviter: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const mappedReceived = receivedInvitations.map(invitation => ({
      id: invitation.id,
      projectId: invitation.projectId,
      projectName: invitation.project.title,
      inviterId: invitation.invitedBy,
      inviterName: invitation.inviter.name || invitation.inviter.email,
      inviterEmail: invitation.inviter.email,
      inviteeEmail: invitation.email,
      role: invitation.role,
      status: invitation.status,
      createdAt: invitation.invitedAt.toISOString(),
      expiresAt: invitation.expiresAt.toISOString(),
      respondedAt: invitation.respondedAt?.toISOString(),
      type: 'received',
    }));

    const mappedSent = sentInvitations.map(invitation => ({
      id: invitation.id,
      projectId: invitation.projectId,
      projectName: invitation.project.title,
      inviterId: invitation.invitedBy,
      inviterName: invitation.inviter.name || invitation.inviter.email,
      inviterEmail: invitation.inviter.email,
      inviteeEmail: invitation.email,
      role: invitation.role,
      status: invitation.status,
      createdAt: invitation.invitedAt.toISOString(),
      expiresAt: invitation.expiresAt.toISOString(),
      respondedAt: invitation.respondedAt?.toISOString(),
      type: 'sent',
    }));

    res.json({
      success: true,
      data: {
        received: mappedReceived,
        sent: mappedSent,
        total: mappedReceived.length + mappedSent.length,
      },
    });
  } catch (error) {
    logger.error('Failed to get all user invitations:', error);
    throw error;
  }
});

export default router;
