import { GeneratedPlan, GeneratedMilestone, GeneratedTask } from '../../shared/types';
import { logger } from '../../shared/utils/logger';

export interface OfflinePlanInput {
  goal: string;
  durationDays: number;
  hoursPerDay: number;
}

const WEEK_THEMES = [
  { title: 'Foundation & basics', focus: 'Learn core concepts and set up your environment' },
  { title: 'Guided practice', focus: 'Apply fundamentals with short exercises' },
  { title: 'Applied project', focus: 'Build something tangible toward your goal' },
  { title: 'Review & consolidation', focus: 'Reflect, fix gaps, and strengthen habits' },
] as const;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function addDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Generate a structured plan without any external API.
 * Output matches GeneratedPlan for existing routes/DB persistence.
 */
export function generateOfflinePlan(input: OfflinePlanInput): GeneratedPlan {
  const durationDays = clamp(Math.round(input.durationDays), 7, 365);
  const hoursPerDay = clamp(Math.round(input.hoursPerDay * 10) / 10, 1, 12);
  const goal = input.goal.trim() || 'Your goal';

  const weekCount = Math.max(1, Math.ceil(durationDays / 7));
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const milestones: GeneratedMilestone[] = [];
  const tasks: GeneratedTask[] = [];
  let dayOffset = 0;
  let cumulativeMilestoneDays = 0;

  for (let w = 0; w < weekCount; w++) {
    const theme = WEEK_THEMES[w % WEEK_THEMES.length];
    const daysInWeek =
      w === weekCount - 1 ? durationDays - w * 7 : Math.min(7, durationDays - w * 7);
    const weekDays = clamp(daysInWeek, 1, 7);
    cumulativeMilestoneDays += weekDays;

    const milestoneEndOffset = Math.min(cumulativeMilestoneDays - 1, durationDays - 1);

    milestones.push({
      title: `Week ${w + 1}: ${theme.title}`,
      durationDays: weekDays,
      targetDate: addDays(start, milestoneEndOffset),
      description: `${theme.focus} for "${goal}".`,
      tasks: [],
    });

    const tasksPerWeek = clamp(Math.floor(hoursPerDay / 2) + 1, 2, 5);
    const sessionMinutes = clamp(Math.round((hoursPerDay * 60) / tasksPerWeek), 30, 180);

    for (let t = 0; t < tasksPerWeek; t++) {
      const offsetInWeek = Math.floor((t / tasksPerWeek) * (weekDays - 1));
      const dueOffsetDays = dayOffset + offsetInWeek;

      if (dueOffsetDays >= durationDays) break;

      const taskTitles = buildTaskTitles(goal, theme.title, t, tasksPerWeek);
      tasks.push({
        title: taskTitles,
        milestoneIndex: w,
        dueOffsetDays,
        durationMinutes: sessionMinutes,
        recurrence: t === 0 && weekDays >= 5 ? 'RRULE:FREQ=DAILY;COUNT=3' : undefined,
        description: `~${sessionMinutes} min · ${hoursPerDay}h/day budget`,
      });
    }

    dayOffset += weekDays;
  }

  logger.info('[AI OFFLINE MODE USED]', {
    goal: goal.substring(0, 60),
    durationDays,
    hoursPerDay,
    weeks: weekCount,
    milestones: milestones.length,
    tasks: tasks.length,
  });

  return {
    milestones,
    tasks,
    notes:
      `Plan generated locally (offline mode) for "${goal}" over ${durationDays} days ` +
      `at ~${hoursPerDay}h/day. Adjust tasks to fit your schedule.`,
  };
}

function buildTaskTitles(goal: string, theme: string, index: number, total: number): string {
  const shortGoal = goal.length > 40 ? `${goal.slice(0, 37)}…` : goal;
  const templates = [
    `Study: ${theme} — ${shortGoal}`,
    `Practice session (${index + 1}/${total})`,
    `Review notes & checklist`,
    `Mini-project step toward ${shortGoal}`,
    `Reflect and plan next session`,
  ];
  return templates[index % templates.length];
}
