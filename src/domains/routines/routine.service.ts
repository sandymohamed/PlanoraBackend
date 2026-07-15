import { getPrismaClient } from '../../shared/utils/database';
import { logger } from '../../shared/utils/logger';
import { Prisma } from '@prisma/client';

export interface RoutineSchedule {
  time?: string; // "05:00"
  days?: number[]; // [1,2,3,4,5] for days of week
  day?: number; // for monthly: day of month
}

export interface CreateRoutineData {
  title: string;
  description?: string;
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  schedule: RoutineSchedule;
  timezone?: string;
  reminderBefore?: string; // e.g., "30m", "2h", "1d", "1w"
  enabled?: boolean;
}

export interface CreateRoutineTaskData {
  title: string;
  description?: string;
  order?: number;
  reminderTime?: string;
}

export class RoutineService {
  /**
   * Create a new routine
   */
  async createRoutine(userId: string, data: CreateRoutineData) {
    const prisma = getPrismaClient();
    
    // Calculate next occurrence
    const nextOccurrence = this.calculateNextOccurrence(
      data.frequency,
      data.schedule,
      data.timezone || 'UTC'
    );

    const routine = await prisma.routine.create({
      data: {
        userId,
        title: data.title,
        description: data.description,
        frequency: data.frequency,
        schedule: data.schedule as Prisma.InputJsonValue,
        timezone: data.timezone || 'UTC',
        reminderBefore: data.reminderBefore || null,
        nextOccurrenceAt: nextOccurrence,
      },
      include: {
        routineTasks: true,
      },
    });

    return routine;
  }

  /**
   * Get all routines for a user
   */
  async getUserRoutines(userId: string) {
    const { executeWithRetry, withPrismaRetry } = await import('../../shared/utils/database');
    const prisma = getPrismaClient();
    
    // Wrap the entire operation in retry logic to handle connection errors
    return executeWithRetry(async () => {
    // First, check and reset any routines that are due
    await this.checkAndResetDueRoutinesForUser(userId);
    
    const routines = await prisma.routine.findMany({
      where: { userId },
      include: {
        routineTasks: {
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    logger.info(`scheduleRoutineNotifications from getUserRoutines for user ${userId} with ${routines.length} routines`);
    // Reschedule reminders for routines that have reminderBefore but might not have reminders yet
    // Run sequentially to avoid Prisma reconnect races when many routines need scheduling
    const { scheduleRoutineNotifications } = await import('../../infrastructure/queue/notificationScheduler');
    const routinesNeedingReminders = routines.filter(
      (routine) => routine.enabled && routine.reminderBefore
    );

    void (async () => {
      for (const routine of routinesNeedingReminders) {
        try {
          const reminderCount = await withPrismaRetry((prisma) =>
            prisma.reminder.count({
              where: {
                userId: routine.userId,
                targetType: 'CUSTOM',
                title: {
                  contains: `Routine Reminder: ${routine.title}`,
                },
              },
            })
          );

          if (reminderCount === 0) {
                logger.info(`2222 scheduleRoutineNotifications from getUserRoutines for user ${userId} with ${routines.length} routines`);

            await scheduleRoutineNotifications(routine.id, routine.userId);
          }
        } catch (error) {
          logger.error(`Error checking reminders for routine ${routine.id}:`, error);
        }
      }
    })();

    return routines;
    }, 3, 1000); // Retry up to 3 times with 1 second delay
  }

  /**
   * Get a single routine by ID
   */
  async getRoutineById(routineId: string, userId: string) {
    const prisma = getPrismaClient();
    
    // First, check if this specific routine needs to be reset
    const routineToCheck = await prisma.routine.findFirst({
      where: {
        id: routineId,
        userId,
      },
    });

    if (routineToCheck && routineToCheck.enabled && routineToCheck.nextOccurrenceAt) {
      const now = new Date();
      if (routineToCheck.nextOccurrenceAt <= now) {
        await this.resetRoutineTasks(routineId);
      }
    }
    
    const routine = await prisma.routine.findFirst({
      where: {
        id: routineId,
        userId,
      },
      include: {
        routineTasks: {
          orderBy: { order: 'asc' },
        },
      },
    });

    return routine;
  }

  /**
   * Update a routine
   */
  async updateRoutine(routineId: string, userId: string, data: Partial<CreateRoutineData>) {
    const prisma = getPrismaClient();
    
    // Check ownership
    const existing = await prisma.routine.findFirst({
      where: {
        id: routineId,
        userId,
      },
    });

    if (!existing) {
      throw new Error('Routine not found');
    }

    const updateData: any = {};
    if (data.title) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.frequency) updateData.frequency = data.frequency;
    if (data.schedule) updateData.schedule = data.schedule;
    if (data.timezone) updateData.timezone = data.timezone;
    if (data.reminderBefore !== undefined) updateData.reminderBefore = data.reminderBefore || null;
    // Handle enabled field - explicitly check for boolean (including false)
    if (data.enabled !== undefined) {
      updateData.enabled = data.enabled;
    }

    // Recalculate next occurrence if schedule changed
    if (data.schedule || data.frequency) {
      const schedule = data.schedule || existing.schedule as RoutineSchedule;
      const frequency = data.frequency || existing.frequency;
      updateData.nextOccurrenceAt = this.calculateNextOccurrence(
        frequency,
        schedule,
        data.timezone || existing.timezone
      );
    }

    if (data.schedule) {
      updateData.schedule = data.schedule as Prisma.InputJsonValue;
    }

    const routine = await prisma.routine.update({
      where: { id: routineId },
      data: updateData,
      include: {
        routineTasks: {
          orderBy: { order: 'asc' },
        },
      },
    });

    return routine;
  }

  /**
   * Delete a routine
   */
  async deleteRoutine(routineId: string, userId: string) {
    const prisma = getPrismaClient();
    
    const routine = await prisma.routine.findFirst({
      where: {
        id: routineId,
        userId,
      },
    });

    if (!routine) {
      throw new Error('Routine not found');
    }

    await prisma.routine.delete({
      where: { id: routineId },
    });

    return { success: true };
  }

  /**
   * Add a task to a routine
   */
  async addTaskToRoutine(routineId: string, userId: string, taskData: CreateRoutineTaskData) {
    const prisma = getPrismaClient();
    
    logger.info("addTaskToRoutine taskData:", taskData);
    // Verify ownership
    const routine = await prisma.routine.findFirst({
      where: {
        id: routineId,
        userId,
      },
    });

    if (!routine) {
      throw new Error('Routine not found');
    }

    // Get max order
    const maxOrder = await prisma.routineTask.aggregate({
      where: { routineId },
      _max: { order: true },
    });

    const task = await prisma.routineTask.create({
      data: {
        routineId,
        title: taskData.title,
        description: taskData.description,
        order: taskData.order || ((maxOrder._max.order || -1) + 1),
        reminderTime: taskData.reminderTime,
      },
    });

    return task;
  }

  /**
   * Update a routine task
   */
  async updateRoutineTask(taskId: string, userId: string, data: Partial<CreateRoutineTaskData>) {
    const prisma = getPrismaClient();
    
    const task = await prisma.routineTask.findUnique({
      where: { id: taskId },
      include: { routine: true },
    });

    if (!task || task.routine.userId !== userId) {
      throw new Error('Task not found');
    }

    const updatedTask = await prisma.routineTask.update({
      where: { id: taskId },
      data: {
        title: data.title,
        description: data.description,
        order: data.order,
        reminderTime: data.reminderTime,
      },
    });

    return updatedTask;
  }

  /**
   * Delete a routine task
   */
  async deleteRoutineTask(taskId: string, userId: string) {
    const prisma = getPrismaClient();
    
    const task = await prisma.routineTask.findUnique({
      where: { id: taskId },
      include: { routine: true },
    });

    if (!task || task.routine.userId !== userId) {
      throw new Error('Task not found');
    }

    await prisma.routineTask.delete({
      where: { id: taskId },
    });

    return { success: true };
  }

  /**
   * Mark routine tasks as completed/uncompleted
   */
  async toggleTaskCompletion(taskId: string, userId: string, completed: boolean) {
    const prisma = getPrismaClient();
    
    const task = await prisma.routineTask.findUnique({
      where: { id: taskId },
      include: { routine: true },
    });

    if (!task || task.routine.userId !== userId) {
      throw new Error('Task not found');
    }

    const updatedTask = await prisma.routineTask.update({
      where: { id: taskId },
      data: {
        completed,
        completedAt: completed ? new Date() : null,
      },
    });

    return updatedTask;
  }

  /**
   * Reset routine tasks when the next occurrence happens
   */
  async resetRoutineTasks(routineId: string) {
    const prisma = getPrismaClient();
    
    const routine = await prisma.routine.findUnique({
      where: { id: routineId },
    });

    if (!routine) {
      throw new Error('Routine not found');
    }

    // Reset all tasks
    await prisma.routineTask.updateMany({
      where: { routineId },
      data: {
        completed: false,
        completedAt: null,
      },
    });

    // Update last reset and next occurrence
    const schedule = routine.schedule as RoutineSchedule;
    const nextOccurrence = this.calculateNextOccurrence(
      routine.frequency,
      schedule,
      routine.timezone
    );

    await prisma.routine.update({
      where: { id: routineId },
      data: {
        lastResetAt: new Date(),
        nextOccurrenceAt: nextOccurrence,
      },
    });

    return { success: true };
  }

  /**
   * Check and reset routines that have passed their next occurrence for a specific user
   */
  async checkAndResetDueRoutinesForUser(userId: string) {
    const prisma = getPrismaClient();
    
    const now = new Date();
    
    const routines = await prisma.routine.findMany({
      where: {
        userId,
        enabled: true,
        nextOccurrenceAt: {
          lte: now,
        },
      },
    });

    for (const routine of routines) {
      try {
        await this.resetRoutineTasks(routine.id);
        
        // Reschedule notifications for the next occurrence after reset
        // Use dynamic import to avoid circular dependencies
         logger.info(`scheduleRoutineNotifications from checkAndResetDueRoutinesForUser for user ${userId} with ${routines.length} routines`);

        const { scheduleRoutineNotifications } = await import('../../infrastructure/queue/notificationScheduler');
        scheduleRoutineNotifications(routine.id, userId)
          .catch(err => logger.error(`Failed to reschedule notifications for routine ${routine.id} after reset:`, err));
      } catch (error) {
        logger.error(`Failed to reset routine ${routine.id}:`, error);
      }
    }
  }

  /**
   * Check and reset routines that have passed their next occurrence (for all users)
   */
  async checkAndResetDueRoutines() {
    const prisma = getPrismaClient();
    
    const now = new Date();
    
    const routines = await prisma.routine.findMany({
      where: {
        enabled: true,
        nextOccurrenceAt: {
          lte: now,
        },
      },
    });

    const results = [];
    for (const routine of routines) {
      try {
        await this.resetRoutineTasks(routine.id);
        results.push({ routineId: routine.id, success: true });
      } catch (error) {
        logger.error(`Failed to reset routine ${routine.id}:`, error);
        results.push({ routineId: routine.id, success: false, error });
      }
    }

    return results;
  }

  /**
   * Get routine tasks as Task objects for integration with task system
   * Converts routine tasks to Task format with appropriate due dates and urgency
   */
  async getRoutineTasksAsTasks(userId: string): Promise<any[]> {
    const prisma = getPrismaClient();
    const now = new Date();
    
    // First check and reset due routines
    await this.checkAndResetDueRoutinesForUser(userId);
    
    // Get all enabled routines with their tasks
    const routines = await prisma.routine.findMany({
      where: {
        userId,
        enabled: true,
      },
      include: {
        routineTasks: {
          orderBy: { order: 'asc' },
        },
      },
    });

    const taskList: any[] = [];

    for (const routine of routines) {
      const schedule = routine.schedule as RoutineSchedule;
      
      for (const routineTask of routine.routineTasks) {
        // For weekly routines, create a task instance for each scheduled day
        if (routine.frequency === 'WEEKLY' && schedule.days && schedule.days.length > 0) {
          const timeParts = schedule.time?.split(':') || ['0', '0'];
          const targetDays = schedule.days;
          const currentDay = now.getDay();
          
          for (const day of targetDays) {
            // Calculate date for this day (this week or next week)
            let taskDate = new Date(now);
            const daysDifference = day - currentDay;
            
            if (daysDifference === 0) {
              // Today is a scheduled day
              taskDate = new Date(now);
            } else if (daysDifference > 0) {
              // Day is later this week
              taskDate.setDate(now.getDate() + daysDifference);
            } else {
              // Day was earlier this week, check if we're past the time
              const thisWeekDay = new Date(now);
              thisWeekDay.setDate(now.getDate() + daysDifference);
              thisWeekDay.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
              
              if (thisWeekDay < now) {
                // This week's occurrence has passed, show next week's
                taskDate.setDate(now.getDate() + daysDifference + 7);
              } else {
                taskDate = thisWeekDay;
              }
            }
            
            taskDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
            
            // Determine if task is urgent and status for this specific day
            // For weekly, check if completed this week (any day)
            const weekStart = new Date(now);
            weekStart.setDate(now.getDate() - now.getDay() + 1);
            weekStart.setHours(0, 0, 0, 0);
            
            const isCompletedThisWeek = routineTask.completed && routineTask.completedAt && 
              new Date(routineTask.completedAt) >= weekStart;
            
            const taskDateTime = new Date(taskDate);
            taskDateTime.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
            
            const isUrgent = !isCompletedThisWeek && taskDateTime < now;
            const taskStatus = isCompletedThisWeek ? 'DONE' : 'TODO';
            const completedAt = isCompletedThisWeek && routineTask.completedAt ? new Date(routineTask.completedAt) : null;

            // Create task instance for this day
            const task = {
              id: `routine_${routineTask.id}_day_${day}`,
              title: routineTask.title,
              description: routineTask.description || undefined,
              status: taskStatus,
              priority: isUrgent ? 'URGENT' : 'MEDIUM',
              dueDate: taskDate.toISOString(),
              dueTime: schedule.time || undefined,
              completedAt: completedAt ? completedAt.toISOString() : undefined,
              projectId: null,
              goalId: null,
              assigneeId: null,
              createdBy: userId,
              tags: ['routine', routine.title.toLowerCase().replace(/\s+/g, '-')],
              order: routineTask.order,
              metadata: {
                routineId: routine.id,
                routineTaskId: routineTask.id,
                routineTitle: routine.title,
                isRoutineTask: true,
                scheduledDay: day,
              },
              createdAt: routineTask.createdAt.toISOString(),
              updatedAt: routineTask.updatedAt.toISOString(),
              isDeleted: false,
              creator: {
                id: userId,
                name: null,
                email: null,
              },
              assignee: null,
              project: null,
              goal: null,
              milestone: null,
            };

            taskList.push(task);
          }
        } else {
          // For daily, monthly, yearly - create single task instance
          const dueDate = this.calculateTaskDueDate(
            routine.frequency,
            schedule,
            routine.lastResetAt || routine.createdAt,
            now
          );

          // Determine if task is urgent and status
          const { isUrgent, taskStatus, completedAt } = this.determineTaskUrgencyAndStatus(
            routineTask,
            routine.frequency,
            schedule,
            dueDate,
            now
          );

          // Convert to Task format
          const task = {
            id: `routine_${routineTask.id}`,
            title: routineTask.title,
            description: routineTask.description || undefined,
            status: taskStatus,
            priority: isUrgent ? 'URGENT' : 'MEDIUM',
            dueDate: dueDate.toISOString(),
            dueTime: schedule.time || undefined,
            completedAt: completedAt ? completedAt.toISOString() : undefined,
            projectId: null,
            goalId: null,
            assigneeId: null,
            createdBy: userId,
            tags: ['routine', routine.title.toLowerCase().replace(/\s+/g, '-')],
            order: routineTask.order,
            metadata: {
              routineId: routine.id,
              routineTaskId: routineTask.id,
              routineTitle: routine.title,
              isRoutineTask: true,
            },
            createdAt: routineTask.createdAt.toISOString(),
            updatedAt: routineTask.updatedAt.toISOString(),
            isDeleted: false,
            creator: {
              id: userId,
              name: null,
              email: null,
            },
            assignee: null,
            project: null,
            goal: null,
            milestone: null,
          };

          taskList.push(task);
        }
      }
    }

    return taskList;
  }

  /**
   * Calculate the due date for a routine task based on frequency
   */
  private calculateTaskDueDate(
    frequency: string,
    schedule: RoutineSchedule,
    lastResetAt: Date,
    now: Date
  ): Date {
    let dueDate: Date;

    switch (frequency) {
      case 'DAILY': {
        const timeParts = schedule.time?.split(':') || ['0', '0'];
        dueDate = new Date(now);
        dueDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
        
        // If time has passed today, it's already due
        if (dueDate > now) {
          // Due time is today
          return dueDate;
        } else {
          // Due time has passed, but we show today's date
          return dueDate;
        }
      }
      case 'WEEKLY': {
        const timeParts = schedule.time?.split(':') || ['0', '0'];
        const targetDays = schedule.days || [];
        const currentDay = now.getDay();
        
        // If today is one of the target days, due date is today
        if (targetDays.includes(currentDay)) {
          dueDate = new Date(now);
          dueDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
          
          // If time has passed today, use today's date anyway (for display)
          // The urgency logic will handle if it's urgent
          return dueDate;
        }
        
        // Find next target day
        let daysToAdd = 0;
        for (let i = 1; i <= 7; i++) {
          const checkDay = (currentDay + i) % 7;
          if (targetDays.includes(checkDay)) {
            daysToAdd = i;
            break;
          }
        }
        
        dueDate = new Date(now);
        dueDate.setDate(dueDate.getDate() + daysToAdd);
        dueDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
        return dueDate;
      }
      case 'MONTHLY': {
        const timeParts = schedule.time?.split(':') || ['0', '0'];
        const targetDay = schedule.day || 1;
        dueDate = new Date(now);
        
        // Set to this month's target day
        dueDate.setDate(targetDay);
        dueDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
        
        // If day has passed this month, it's next month
        if (dueDate < now) {
          dueDate.setMonth(dueDate.getMonth() + 1);
        }
        
        return dueDate;
      }
      case 'YEARLY': {
        const timeParts = schedule.time?.split(':') || ['0', '0'];
        dueDate = new Date(now);
        dueDate.setMonth(0);
        dueDate.setDate(1);
        dueDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
        
        if (dueDate < now) {
          dueDate.setFullYear(dueDate.getFullYear() + 1);
        }
        
        return dueDate;
      }
      default:
        return new Date(now);
    }
  }

  /**
   * Determine if a routine task is urgent and its status
   */
  private determineTaskUrgencyAndStatus(
    routineTask: any,
    frequency: string,
    schedule: RoutineSchedule,
    dueDate: Date,
    now: Date
  ): { isUrgent: boolean; taskStatus: string; completedAt: Date | null } {
    const isCompleted = routineTask.completed;
    const completedAtDate = routineTask.completedAt ? new Date(routineTask.completedAt) : null;
    
    // If completed, check if it was completed in the current cycle
    if (isCompleted && completedAtDate) {
      let isInCurrentCycle = false;
      
      switch (frequency) {
        case 'DAILY': {
          // Check if completed today
          const today = new Date(now);
          today.setHours(0, 0, 0, 0);
          const completedToday = new Date(completedAtDate);
          completedToday.setHours(0, 0, 0, 0);
          isInCurrentCycle = completedToday.getTime() === today.getTime();
          break;
        }
        case 'WEEKLY': {
          // Check if completed this week (since last Monday)
          const weekStart = new Date(now);
          weekStart.setDate(now.getDate() - now.getDay() + 1);
          weekStart.setHours(0, 0, 0, 0);
          isInCurrentCycle = completedAtDate >= weekStart;
          break;
        }
        case 'MONTHLY': {
          // Check if completed this month
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          isInCurrentCycle = completedAtDate >= monthStart;
          break;
        }
        case 'YEARLY': {
          // Check if completed this year
          const yearStart = new Date(now.getFullYear(), 0, 1);
          isInCurrentCycle = completedAtDate >= yearStart;
          break;
        }
      }
      
      if (isInCurrentCycle) {
        return { isUrgent: false, taskStatus: 'DONE', completedAt: completedAtDate };
      }
    }
    
    // Not completed or completed in previous cycle
    // Check if it's urgent (past due time for current cycle)
    const timeParts = schedule.time?.split(':') || ['0', '0'];
    let currentCycleDueDate: Date;
    
    switch (frequency) {
      case 'DAILY': {
        // Due time today
        currentCycleDueDate = new Date(now);
        currentCycleDueDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
        break;
      }
      case 'WEEKLY': {
        // Due time on scheduled day this week
        const targetDays = schedule.days || [];
        const currentDay = now.getDay();
        
        if (targetDays.includes(currentDay)) {
          // Today is a scheduled day
          currentCycleDueDate = new Date(now);
          currentCycleDueDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
        } else {
          // Find if we're past the last scheduled day this week
          const weekStart = new Date(now);
          weekStart.setDate(now.getDate() - now.getDay());
          weekStart.setHours(0, 0, 0, 0);
          
          // Find the last scheduled day of the week
          let lastScheduledDay = -1;
          for (let day = 6; day >= 0; day--) {
            if (targetDays.includes(day)) {
              lastScheduledDay = day;
              break;
            }
          }
          
          if (lastScheduledDay >= 0) {
            const lastDay = new Date(weekStart);
            lastDay.setDate(weekStart.getDate() + lastScheduledDay);
            lastDay.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
            currentCycleDueDate = lastDay;
          } else {
            currentCycleDueDate = dueDate;
          }
        }
        break;
      }
      case 'MONTHLY': {
        // Due time on scheduled day this month
        const targetDay = schedule.day || 1;
        currentCycleDueDate = new Date(now);
        currentCycleDueDate.setDate(targetDay);
        currentCycleDueDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
        break;
      }
      case 'YEARLY': {
        // Due time on scheduled date this year
        currentCycleDueDate = new Date(now);
        currentCycleDueDate.setMonth(0);
        currentCycleDueDate.setDate(1);
        currentCycleDueDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
        break;
      }
      default:
        currentCycleDueDate = dueDate;
    }
    
    // Task is urgent if not completed and current cycle due time has passed
    const isUrgent = !isCompleted && currentCycleDueDate < now;
    
    return {
      isUrgent,
      taskStatus: isCompleted && completedAtDate ? 'DONE' : 'TODO',
      completedAt: completedAtDate,
    };
  }

  /**
   * Calculate next occurrence based on frequency and schedule
   */
  private calculateNextOccurrence(
    frequency: string,
    schedule: RoutineSchedule,
    _timezone: string
  ): Date {
    const now = new Date();
    let next: Date;

    switch (frequency) {
      case 'DAILY': {
        const timeParts = schedule.time?.split(':') || ['0', '0'];
        next = new Date(now);
        next.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
        if (next <= now) {
          next.setDate(next.getDate() + 1);
        }
        break;
      }
      case 'WEEKLY': {
        const timeParts = schedule.time?.split(':') || ['0', '0'];
        next = new Date(now);
        const targetDays = schedule.days || [];
        const currentDay = now.getDay();
        
        // Find next day
        let daysToAdd = 0;
        for (let i = 1; i <= 7; i++) {
          const checkDay = (currentDay + i) % 7;
          if (targetDays.includes(checkDay)) {
            daysToAdd = i;
            break;
          }
        }
        
        next.setDate(next.getDate() + daysToAdd);
        next.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
        break;
      }
      case 'MONTHLY': {
        const timeParts = schedule.time?.split(':') || ['0', '0'];
        next = new Date(now);
        const targetDay = schedule.day || 1;
        
        next.setDate(targetDay);
        next.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
        
        if (next <= now) {
          next.setMonth(next.getMonth() + 1);
        }
        break;
      }
      case 'YEARLY': {
        const timeParts = schedule.time?.split(':') || ['0', '0'];
        next = new Date(now);
        
        next.setDate(1);
        next.setMonth(0);
        next.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
        
        if (next <= now) {
          next.setFullYear(next.getFullYear() + 1);
        }
        break;
      }
      default:
        next = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }

    return next;
  }
}

export const routineService = new RoutineService();


