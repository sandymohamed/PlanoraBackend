import { Router, Response } from 'express';
import Joi from 'joi';
import { getPrismaClient } from '../../shared/utils/database';
import { authenticateToken } from '../../shared/middleware/auth';
import { AuthenticatedRequest, ValidationError } from '../../shared/types';
import { aiService } from './ai.service';
import { logger } from '../../shared/utils/logger';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

const generatePlanSchema = Joi.object({
  goalId: Joi.string().uuid().required(),
  promptOptions: Joi.object({
    intensity: Joi.string().valid('low', 'medium', 'high').optional(),
    weeklyHours: Joi.number().min(1).max(168).optional(),
    language: Joi.string().valid('en', 'ar').optional(),
    tone: Joi.string().valid('supportive', 'professional', 'casual').optional(),
  }).optional(),
});

// Helper function to calculate milestone date (fallback when AI doesn't provide date)
const calculateMilestoneDate = (
  now: Date,
  goalTargetDate: Date | null,
  cumulativeDays: number,
  totalDuration: number,
  goalHasTargetDate: Date | null
): Date => {
  let milestoneDueDate: Date;
  
  if (goalHasTargetDate && goalTargetDate) {
    // If goal has target date, distribute milestones from now to target date
    // The last milestone should end on or before the target date
    const progressRatio = cumulativeDays / totalDuration;
    const totalDaysAvailable = Math.ceil((goalTargetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const daysFromStart = Math.floor(totalDaysAvailable * progressRatio);
    
    milestoneDueDate = new Date(now);
    milestoneDueDate.setDate(now.getDate() + daysFromStart);
    
    // Ensure the last milestone doesn't exceed the target date
    if (milestoneDueDate > goalTargetDate) {
      milestoneDueDate = new Date(goalTargetDate);
    }
  } else {
    // If no target date, use milestone durations from today
    milestoneDueDate = new Date(now);
    milestoneDueDate.setDate(now.getDate() + cumulativeDays);
  }
  
  return milestoneDueDate;
};

// POST /api/v1/ai/generate-plan
router.post('/generate-plan', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error, value } = generatePlanSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { goalId, promptOptions = {} } = value;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Get the goal
    const goal = await prisma.goal.findFirst({
      where: {
        id: goalId,
        userId,
      },
    });

    if (!goal) {
      return res.status(404).json({
        success: false,
        error: 'Goal not found',
      });
    }

    // Generate the plan using AI
    const plan = await aiService.generatePlan(
      goal.title,
      goal.description || '',
      goal.targetDate?.toISOString() || new Date().toISOString(),
      promptOptions
    );

    // Create milestones and tasks in the database
    const createdMilestones = [];
    const createdTasks = [];

    // Calculate milestone due dates based on goal target date and milestone durations
    const now = new Date();
    now.setHours(0, 0, 0, 0); // Start of today
    
    const goalTargetDate = goal.targetDate ? new Date(goal.targetDate) : null;
    if (goalTargetDate) {
      goalTargetDate.setHours(23, 59, 59, 999); // Set to end of target day
    }
    
    // Calculate total duration of all milestones
    const totalDuration = plan.milestones.reduce((sum, m) => sum + m.durationDays, 0);
    
    // Calculate cumulative days for milestone due dates
    let cumulativeDays = 0;
    
    for (const milestoneData of plan.milestones) {
      cumulativeDays += milestoneData.durationDays;
      
      // Calculate milestone due date - prefer AI-generated date if available
      let milestoneDueDate: Date;
      
      if (milestoneData.targetDate) {
        // Use AI-generated date if provided
        milestoneDueDate = new Date(milestoneData.targetDate);
        // Validate the date is valid
        if (isNaN(milestoneDueDate.getTime())) {
          // Fallback to calculation if AI date is invalid
          milestoneDueDate = calculateMilestoneDate(now, goalTargetDate, cumulativeDays, totalDuration, goal.targetDate);
        } else {
          // Ensure AI-generated date doesn't exceed goal target date
          if (goal.targetDate && goalTargetDate && milestoneDueDate > goalTargetDate) {
            milestoneDueDate = new Date(goalTargetDate);
          }
          // Ensure AI-generated date is not before today
          if (milestoneDueDate < now) {
            milestoneDueDate = new Date(now);
          }
        }
      } else {
        // Fallback to calculated date if AI didn't provide one
        milestoneDueDate = calculateMilestoneDate(now, goalTargetDate, cumulativeDays, totalDuration, goal.targetDate);
      }
      
      const milestone = await prisma.milestone.create({
        data: {
          goalId: goal.id,
          title: milestoneData.title,
          description: milestoneData.description || null,
          dueDate: milestoneDueDate,
          status: 'TODO',
        },
      });
      createdMilestones.push(milestone);
      
      // Schedule notifications for milestone due date
      if (milestone.dueDate) {
        const { scheduleMilestoneDueDateNotifications } = await import('../../infrastructure/queue/notificationScheduler');
        scheduleMilestoneDueDateNotifications(milestone.id, goal.id, userId, milestone.dueDate, milestone.title)
          .catch(err => logger.error('Failed to schedule milestone notifications:', err));
      }
    }

    for (const taskData of plan.tasks) {
      const milestone = createdMilestones[taskData.milestoneIndex];
      
      // Calculate task due date based on dueOffsetDays from the start
      let taskDueDate: Date;
      
      if (goal.targetDate && goalTargetDate) {
        // If goal has target date, calculate task date proportionally
        const totalDaysAvailable = Math.ceil((goalTargetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        // Use the maximum duration from all tasks to scale the offset
        const maxTaskOffset = Math.max(...plan.tasks.map(t => t.dueOffsetDays), 1);
        const scaledOffset = Math.floor((taskData.dueOffsetDays / maxTaskOffset) * totalDaysAvailable);
        
        taskDueDate = new Date(now);
        taskDueDate.setDate(now.getDate() + scaledOffset);
        
        // Ensure task doesn't exceed goal target date
        if (taskDueDate > goalTargetDate) {
          taskDueDate = new Date(goalTargetDate);
        }
        
        // If task belongs to a milestone, ensure it doesn't exceed milestone due date
        if (milestone && milestone.dueDate) {
          const milestoneDueDate = new Date(milestone.dueDate);
          if (taskDueDate > milestoneDueDate) {
            taskDueDate = new Date(milestoneDueDate);
          }
        }
      } else {
        // If no target date, use dueOffsetDays directly from today
        taskDueDate = new Date(now);
        taskDueDate.setDate(now.getDate() + taskData.dueOffsetDays);
      }
      
      // Ensure task is not in the past
      if (taskDueDate < now) {
        taskDueDate = new Date(now);
      }
      
      const dueDate = taskDueDate;

      const task = await prisma.task.create({
        data: {
          title: taskData.title,
          description: taskData.description,
          creatorId: userId,
          goalId: goal.id,
          milestoneId: milestone?.id,
          priority: 'MEDIUM',
          status: 'TODO',
          dueDate: dueDate,
          recurrenceRule: taskData.recurrence,
          metadata: {
            durationMinutes: taskData.durationMinutes,
            aiGenerated: true,
          },
        },
      });
      createdTasks.push(task);
    }

    // Update goal to mark as plan generated
    await prisma.goal.update({
      where: { id: goal.id },
      data: {
        planGenerated: true,
        planSource: 'AI',
      },
    });

    logger.info('AI plan generated successfully', {
      goalId,
      userId,
      milestonesCount: createdMilestones.length,
      tasksCount: createdTasks.length,
    });

    // Map milestone dueDate to targetDate for frontend compatibility
    const milestonesWithTargetDate = createdMilestones.map((milestone: any) => ({
      ...milestone,
      targetDate: milestone.dueDate ? milestone.dueDate.toISOString() : null,
    }));

  return  res.json({
      success: true,
      data: {
        plan,
        milestones: milestonesWithTargetDate,
        tasks: createdTasks,
      },
      message: 'Plan generated successfully',
    });
  } catch (error) {
    logger.error('AI plan generation error:', error);
    
    // Return error response instead of throwing
    const errorMessage = error instanceof Error ? error.message : 'Failed to generate AI plan';
    const statusCode = error instanceof ValidationError ? 400 : 500;
    
    return res.status(statusCode).json({
      success: false,
      error: errorMessage,
      message: 'Failed to generate plan. Please try again or contact support if the issue persists.',
    });
  }
});

// POST /api/v1/ai/generate-simple-plan
router.post('/generate-simple-plan', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { goalTitle } = req.body;

    if (!goalTitle) {
      throw new ValidationError('Goal title is required');
    }

    // Generate a simple plan for testing
    const plan = await aiService.generateSimplePlan(goalTitle);

    return  res.json({
      success: true,
      data: plan,
      message: 'Simple plan generated successfully',
    });
  } catch (error) {
    logger.error('Simple plan generation error:', error);
    
    // Return error response instead of throwing
    const errorMessage = error instanceof Error ? error.message : 'Failed to generate AI plan';
    const statusCode = error instanceof ValidationError ? 400 : 500;
    
    return res.status(statusCode).json({
      success: false,
      error: errorMessage,
      message: 'Failed to generate simple plan. Please try again or contact support if the issue persists.',
    });
  }
});

export default router;

