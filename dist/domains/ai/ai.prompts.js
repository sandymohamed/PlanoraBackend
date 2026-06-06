"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPlanMessages = buildPlanMessages;
exports.buildWeeklyReviewMessages = buildWeeklyReviewMessages;
const ai_constants_1 = require("./ai.constants");
/**
 * Compact, JSON-only plan prompt. No markdown, no prose — keeps free-tier
 * token usage minimal while preserving the GeneratedPlan shape downstream.
 */
function buildPlanMessages(input) {
    const { maxMilestones, maxTasksPerMilestone } = ai_constants_1.AI_CONSTANTS;
    const schema = `milestones[{title,target_date,duration_days,description}], ` +
        `tasks[{title,milestone_index,due_offset_days,duration_minutes,description}], notes`;
    const rules = `Return ONLY a JSON object. No markdown, no commentary. ` +
        `Max ${maxMilestones} milestones, max ${maxTasksPerMilestone} tasks per milestone. ` +
        `Keep titles short. duration_days/due_offset_days are integers within the plan window.`;
    const system = input.language === 'ar'
        ? `مخطط أهداف. أعد JSON فقط: ${schema}. بدون شرح أو ماركداون. حد أقصى ${maxMilestones} مراحل و${maxTasksPerMilestone} مهام لكل مرحلة.`
        : `You are a concise goal planner. JSON object only: ${schema}. ${rules}`;
    const user = JSON.stringify({
        goal: input.goal,
        durationDays: input.durationDays,
        hoursPerDay: input.hoursPerDay,
    });
    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}
/** Short motivational weekly-review prompt — JSON only. */
function buildWeeklyReviewMessages(stats) {
    const user = JSON.stringify({
        completed: stats.completedTasks,
        missed: stats.missedTasks,
        consistency: stats.consistencyScore,
        bestDays: stats.bestDays,
    });
    return [
        {
            role: 'system',
            content: 'You are a supportive productivity coach. JSON object only, no markdown: ' +
                'insights[] (max 3), recommendations[] (max 3), shareableSummary (one short sentence).',
        },
        { role: 'user', content: user },
    ];
}
