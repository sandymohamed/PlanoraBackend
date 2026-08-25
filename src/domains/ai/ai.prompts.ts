import { ChatMessage } from "./providers/provider.types";
import { AI_CONSTANTS } from "./ai.constants";


export interface PlanPromptInput {
  goal: string;
  durationDays: number;
  hoursPerDay: number;
  language: string;
  startDate: string;
  targetDate: string;
}

/**
 * Compact, JSON-only plan prompt. No markdown, no prose — keeps free-tier
 * token usage minimal while preserving the GeneratedPlan shape downstream.
 */
// ==================== AI PLAN PROMPT UPDATE ====================

export interface PlanPromptInput {
  goal: string;
  durationDays: number;
  hoursPerDay: number;
  language: string;
  targetDate: string;
}

export function buildPlanMessages(input: PlanPromptInput): ChatMessage[] {
  const { maxMilestones, maxTasksPerMilestone } = AI_CONSTANTS;

  const schema =
    `milestones[{title,target_date,duration_days,description}], ` +
    `tasks[{title,milestone_index,due_offset_days,duration_minutes,description}], notes`;

  const rules =
    `Return ONLY a JSON object. No markdown, no commentary. ` +
    `Create a realistic step-by-step plan for the goal. ` +
    `Max ${maxMilestones} milestones, max ${maxTasksPerMilestone} tasks per milestone. ` +
    `Keep milestone and task titles short and clear. ` +
    // Milestone quality
    `Each milestone must be a meaningful standalone stage of the goal. ` +
    `The milestone must make sense even when its tasks are not visible. ` +
    // Important temporary mobile UI workaround
    `Because users may not see milestone tasks, the milestone description MUST include ` +
    `a concise list of the task titles belonging to that milestone. ` +
    `Use natural readable text such as "Tasks: ...". ` +
    // Date rules
    `The plan starts on ${input.startDate} and ends on ${input.targetDate}. ` +
    `Every milestone target_date MUST be between the start date and target date. ` +
    `Milestone target_dates MUST be chronological and must never be before the start date. ` +
    `The final milestone target_date MUST be the goal target date. ` +
    `Distribute milestone dates realistically across the entire available period. ` +
    `Do not assign all milestones the same date unless the goal duration is extremely short. ` +
    // Task date rules
    `Each task must belong to exactly one milestone using milestone_index. ` +
    `due_offset_days must be a non-negative integer within the plan window. ` +
    `Tasks should be distributed across the milestone period rather than all occurring on the same day. ` +
    `duration_days and due_offset_days must be integers within the plan window.`;

  const system =
    input.language === "ar"
      ? `أنت مخطط أهداف ذكي. أعد JSON فقط: ${schema}. بدون شرح أو ماركداون. ` +
        `حد أقصى ${maxMilestones} مراحل و${maxTasksPerMilestone} مهام لكل مرحلة. ` +
        `كل مرحلة يجب أن تكون خطوة واضحة ومتكاملة نحو الهدف ويمكن فهمها بدون رؤية المهام. ` +
        `يجب أن يحتوي وصف كل مرحلة على عناوين المهام التابعة لها بشكل مختصر. ` +
        `يجب توزيع تواريخ المراحل زمنياً من تاريخ البداية حتى تاريخ الهدف، ` +
        `ويجب أن يكون تاريخ آخر مرحلة هو تاريخ الهدف.`
      : `You are a concise goal planner. JSON object only: ${schema}. ${rules}`;

  const user = JSON.stringify({
    goal: input.goal,
    durationDays: input.durationDays,
    hoursPerDay: input.hoursPerDay,
    startDate: input.startDate,
    targetDate: input.targetDate,
  });

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export interface ReviewPromptInput {
  completedTasks: number;
  missedTasks: number;
  consistencyScore: number;
  bestDays: { date: string; completed: number }[];
}

/** Short motivational weekly-review prompt — JSON only. */
export function buildWeeklyReviewMessages(
  stats: ReviewPromptInput,
): ChatMessage[] {
  const user = JSON.stringify({
    completed: stats.completedTasks,
    missed: stats.missedTasks,
    consistency: stats.consistencyScore,
    bestDays: stats.bestDays,
  });

  return [
    {
      role: "system",
      content:
        "You are a supportive productivity coach. JSON object only, no markdown: " +
        "insights[] (max 3), recommendations[] (max 3), shareableSummary (one short sentence).",
    },
    { role: "user", content: user },
  ];
}
