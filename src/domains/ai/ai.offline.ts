import { GeneratedPlan, GeneratedMilestone, GeneratedTask } from '../../shared/types';
import { logger } from '../../shared/utils/logger';

export interface OfflinePlanInput {
  goal: string;
  description?: string;
  category?: string;
  durationDays: number;
  hoursPerDay: number;
}

type OfflineCategory =
  | 'finance'
  | 'fitness'
  | 'learning'
  | 'career'
  | 'health'
  | 'creative'
  | 'project'
  | 'habit'
  | 'general';

interface ThemeTemplate {
  title: string;
  focus: string;
  tasks: string[];
  recurrence?: 'daily' | 'weekly';
}

const CATEGORY_KEYWORDS: Record<OfflineCategory, string[]> = {
  finance: [
    'saving',
    'savings',
    'save',
    'fund',
    'money',
    'budget',
    'debt',
    'invest',
    'investment',
    'expense',
    'emergency fund',
  ],
  fitness: ['sport', 'sports', 'fitness', 'gym', 'run', 'running', 'workout', 'muscle', 'weight', 'marathon', 'cycling'],
  learning: ['learn', 'study', 'course', 'exam', 'language', 'book', 'skill', 'certification', 'coding', 'programming'],
  career: ['career', 'job', 'interview', 'portfolio', 'resume', 'cv', 'promotion', 'freelance', 'business'],
  health: ['health', 'sleep', 'diet', 'nutrition', 'meditation', 'stress', 'therapy', 'doctor', 'mental'],
  creative: ['write', 'writing', 'music', 'art', 'design', 'draw', 'drawing', 'content', 'youtube', 'podcast'],
  project: ['project', 'launch', 'build', 'app', 'website', 'product', 'startup', 'mvp'],
  habit: ['habit', 'routine', 'daily', 'consistency', 'discipline', 'wake', 'morning'],
  general: [],
};

const CATEGORY_TEMPLATES: Record<OfflineCategory, ThemeTemplate[]> = {
  finance: [
    {
      title: 'Baseline and target amount',
      focus: 'Calculate the exact money target, current balance, and weekly contribution needed',
      tasks: ['Audit income and expenses', 'Set target amount and deadline', 'Choose weekly saving amount', 'Create a separate saving place'],
      recurrence: 'weekly',
    },
    {
      title: 'Budget and saving system',
      focus: 'Build a simple budget that protects the fund before spending happens',
      tasks: ['Cut or cap one expense category', 'Schedule automatic transfer', 'Track spending leaks', 'Review weekly fund progress'],
      recurrence: 'weekly',
    },
    {
      title: 'Increase contributions',
      focus: 'Find extra cash through small income boosts or better spending decisions',
      tasks: ['List quick extra income options', 'Sell or cancel one unused item', 'Move extra cash to the fund', 'Compare actual vs planned saving'],
      recurrence: 'weekly',
    },
    {
      title: 'Review and protect the fund',
      focus: 'Confirm the plan is sustainable and prevent withdrawals from breaking progress',
      tasks: ['Review total saved', 'Adjust next contribution', 'Define when the fund can be used', 'Plan next saving milestone'],
      recurrence: 'weekly',
    },
  ],
  fitness: [
    {
      title: 'Baseline and technique',
      focus: 'Measure current fitness, choose safe exercises, and establish proper form',
      tasks: ['Record baseline fitness numbers', 'Do technique-focused workout', 'Plan warm-up and recovery', 'Prepare workout schedule'],
      recurrence: 'daily',
    },
    {
      title: 'Consistent training',
      focus: 'Build repeatable workouts with manageable intensity and rest',
      tasks: ['Complete main workout session', 'Add mobility or stretching', 'Log sets, reps, or distance', 'Plan recovery day'],
      recurrence: 'daily',
    },
    {
      title: 'Progressive overload',
      focus: 'Increase training difficulty gradually without sacrificing recovery',
      tasks: ['Increase one training variable', 'Review nutrition and hydration', 'Check soreness and sleep', 'Complete progress workout'],
      recurrence: 'daily',
    },
    {
      title: 'Test and adjust',
      focus: 'Retest progress, keep what works, and adjust the next training block',
      tasks: ['Run progress test', 'Compare baseline vs current', 'Identify weak point', 'Set next training target'],
      recurrence: 'daily',
    },
  ],
  learning: [
    {
      title: 'Map the curriculum',
      focus: 'Break the skill into topics, resources, and practice blocks',
      tasks: ['Choose primary learning resource', 'List key topics to master', 'Set study schedule', 'Create notes system'],
      recurrence: 'daily',
    },
    {
      title: 'Core study and recall',
      focus: 'Learn fundamentals and use active recall instead of passive reading',
      tasks: ['Study one core topic', 'Make flashcards or summary notes', 'Solve practice questions', 'Review yesterday mistakes'],
      recurrence: 'daily',
    },
    {
      title: 'Apply with exercises',
      focus: 'Turn knowledge into usable skill through small practical exercises',
      tasks: ['Complete practice exercise', 'Explain concept in your words', 'Fix weak areas', 'Build small example'],
      recurrence: 'daily',
    },
    {
      title: 'Review and checkpoint',
      focus: 'Test understanding and prepare the next learning cycle',
      tasks: ['Take checkpoint quiz', 'Review incorrect answers', 'Update learning roadmap', 'Plan next topic'],
      recurrence: 'daily',
    },
  ],
  career: [
    {
      title: 'Positioning and target roles',
      focus: 'Clarify the role, skills, and proof needed to move forward',
      tasks: ['Define target role', 'Analyze 3 job descriptions', 'List skill gaps', 'Update career goal statement'],
    },
    {
      title: 'Proof and portfolio',
      focus: 'Create evidence that shows your ability clearly',
      tasks: ['Improve resume or CV', 'Write one portfolio case study', 'Update LinkedIn/profile', 'Collect measurable achievements'],
    },
    {
      title: 'Outreach and applications',
      focus: 'Build momentum through targeted applications and networking',
      tasks: ['Send targeted application', 'Message one relevant contact', 'Practice interview answer', 'Track application pipeline'],
    },
    {
      title: 'Interview and negotiation prep',
      focus: 'Prepare for conversations, feedback, and next opportunities',
      tasks: ['Run mock interview', 'Prepare salary range', 'Review feedback', 'Plan next outreach batch'],
    },
  ],
  health: [
    {
      title: 'Baseline and triggers',
      focus: 'Understand current health patterns and choose one safe improvement',
      tasks: ['Record baseline habit', 'Identify main trigger', 'Choose one small change', 'Prepare supportive environment'],
      recurrence: 'daily',
    },
    {
      title: 'Daily health routine',
      focus: 'Repeat small actions that improve energy and recovery',
      tasks: ['Complete planned health action', 'Track sleep, mood, or energy', 'Prepare healthy option', 'Do short recovery practice'],
      recurrence: 'daily',
    },
    {
      title: 'Adjust and remove friction',
      focus: 'Make the routine easier to repeat and harder to skip',
      tasks: ['Remove one obstacle', 'Review trigger pattern', 'Adjust timing', 'Ask for support if needed'],
      recurrence: 'daily',
    },
    {
      title: 'Review health progress',
      focus: 'Compare baseline with current state and plan a sustainable next step',
      tasks: ['Review health log', 'Keep the best habit', 'Set next small target', 'Plan maintenance routine'],
      recurrence: 'daily',
    },
  ],
  creative: [
    {
      title: 'Concept and references',
      focus: 'Define the creative direction and collect useful inspiration',
      tasks: ['Write project brief', 'Collect references', 'Choose format and constraints', 'Create first outline or sketch'],
    },
    {
      title: 'First draft',
      focus: 'Produce a rough version without over-editing',
      tasks: ['Create draft segment', 'Block focused creation time', 'Capture open questions', 'Save version notes'],
    },
    {
      title: 'Refine and get feedback',
      focus: 'Improve clarity, quality, and audience fit',
      tasks: ['Edit one section', 'Ask for feedback', 'Apply one improvement', 'Prepare final checklist'],
    },
    {
      title: 'Publish or share',
      focus: 'Finish the piece and make it available to the intended audience',
      tasks: ['Finalize output', 'Prepare title or description', 'Share or publish', 'Log lessons learned'],
    },
  ],
  project: [
    {
      title: 'Scope and requirements',
      focus: 'Define the outcome, constraints, and first deliverable',
      tasks: ['Write project scope', 'List must-have requirements', 'Break work into modules', 'Set first milestone deliverable'],
    },
    {
      title: 'Build core version',
      focus: 'Create the smallest useful version of the project',
      tasks: ['Implement core task', 'Review blockers', 'Test main path', 'Commit or document progress'],
    },
    {
      title: 'Polish and validation',
      focus: 'Fix rough edges and confirm the project works for real use',
      tasks: ['Fix one issue', 'Improve user flow', 'Collect test feedback', 'Update project checklist'],
    },
    {
      title: 'Launch and review',
      focus: 'Ship the project and capture what to improve next',
      tasks: ['Prepare launch notes', 'Publish or deliver', 'Monitor feedback', 'Plan next iteration'],
    },
  ],
  habit: [
    {
      title: 'Cue and tiny action',
      focus: 'Attach the habit to a clear trigger and make it easy to start',
      tasks: ['Choose habit cue', 'Define tiny version', 'Prepare environment', 'Track first repetitions'],
      recurrence: 'daily',
    },
    {
      title: 'Consistency streak',
      focus: 'Repeat the habit and protect the streak from common obstacles',
      tasks: ['Complete daily habit', 'Log streak', 'Use backup plan', 'Remove one friction point'],
      recurrence: 'daily',
    },
    {
      title: 'Increase difficulty',
      focus: 'Grow the habit only after the easy version is stable',
      tasks: ['Add small increase', 'Review missed days', 'Reward completion', 'Keep backup version ready'],
      recurrence: 'daily',
    },
    {
      title: 'Make it automatic',
      focus: 'Lock the habit into routine and plan long-term maintenance',
      tasks: ['Review streak data', 'Choose maintenance level', 'Plan relapse recovery', 'Set next habit target'],
      recurrence: 'daily',
    },
  ],
  general: [
    {
      title: 'Define success and first steps',
      focus: 'Clarify the target outcome and break it into manageable work',
      tasks: ['Write success criteria', 'Break down first milestone', 'Prepare resources', 'Schedule first work session'],
    },
    {
      title: 'Build momentum',
      focus: 'Make steady progress through focused sessions and small reviews',
      tasks: ['Complete focused work block', 'Review progress', 'Resolve one blocker', 'Plan next action'],
    },
    {
      title: 'Apply and improve',
      focus: 'Turn planning into tangible progress and improve based on results',
      tasks: ['Complete practical step', 'Check quality', 'Adjust approach', 'Document lessons learned'],
    },
    {
      title: 'Review and consolidate',
      focus: 'Reflect, fix gaps, and prepare the next phase',
      tasks: ['Review completed work', 'Close remaining gap', 'Update goal progress', 'Plan next milestone'],
    },
  ],
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function addDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function normalizeText(value?: string): string {
  return (value ?? '').trim().toLowerCase();
}

function inferCategory(input: OfflinePlanInput): OfflineCategory {
  const rawCategory = normalizeText(input.category);
  const searchable = `${rawCategory} ${normalizeText(input.goal)} ${normalizeText(input.description)}`;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as Array<[OfflineCategory, string[]]>) {
    if (category === 'general') continue;
    if (rawCategory === category || keywords.some((keyword) => searchable.includes(keyword))) {
      return category;
    }
  }

  return 'general';
}

function recurrenceFor(theme: ThemeTemplate, taskIndex: number, weekDays: number): string | undefined {
  if (!theme.recurrence || taskIndex !== 0 || weekDays < 5) return undefined;
  if (theme.recurrence === 'daily') return 'RRULE:FREQ=DAILY;COUNT=3';
  return 'RRULE:FREQ=WEEKLY;COUNT=3';
}

/**
 * Generate a structured plan without any external API.
 * Output matches GeneratedPlan for existing routes/DB persistence.
 */
export function generateOfflinePlan(input: OfflinePlanInput): GeneratedPlan {
  const durationDays = clamp(Math.round(input.durationDays), 7, 365);
  const hoursPerDay = clamp(Math.round(input.hoursPerDay * 10) / 10, 1, 12);
  const goal = input.goal.trim() || 'Your goal';
  const category = inferCategory(input);
  const themes = CATEGORY_TEMPLATES[category];

  const weekCount = Math.max(1, Math.ceil(durationDays / 7));
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const milestones: GeneratedMilestone[] = [];
  const tasks: GeneratedTask[] = [];
  let dayOffset = 0;
  let cumulativeMilestoneDays = 0;

  for (let w = 0; w < weekCount; w++) {
    const theme = themes[w % themes.length];
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

      const taskTitles = buildTaskTitle(goal, theme, t);
      tasks.push({
        title: taskTitles,
        milestoneIndex: w,
        dueOffsetDays,
        durationMinutes: sessionMinutes,
        recurrence: recurrenceFor(theme, t, weekDays),
        description: `~${sessionMinutes} min · ${hoursPerDay}h/day budget · ${category} plan`,
      });
    }

    dayOffset += weekDays;
  }

  logger.info('[AI OFFLINE MODE USED]', {
    goal: goal.substring(0, 60),
    durationDays,
    hoursPerDay,
    category,
    weeks: weekCount,
    milestones: milestones.length,
    tasks: tasks.length,
  });

  return {
    milestones,
    tasks,
    notes:
      `Plan generated locally (offline mode) as a ${category} plan for "${goal}" over ${durationDays} days ` +
      `at ~${hoursPerDay}h/day. Adjust tasks to fit your schedule.`,
  };
}

function buildTaskTitle(goal: string, theme: ThemeTemplate, index: number): string {
  const shortGoal = goal.length > 40 ? `${goal.slice(0, 37)}…` : goal;
  const task = theme.tasks[index % theme.tasks.length];
  return `${task} - ${shortGoal}`;
}
