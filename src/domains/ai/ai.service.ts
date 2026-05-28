import OpenAI from 'openai';
import { logger } from '../../shared/utils/logger';
import { createDevHttpsAgent } from '../../shared/utils/httpAgent';
import { GeneratedPlan, GeneratedMilestone, GeneratedTask } from '../../shared/types';
import { generateCacheKey, getCachedPlan, setCachedPlan } from './ai.cache';
import { checkAiDailyLimit } from './ai.limits';
import { generateOfflinePlan } from './ai.offline';
import {
  computeDurationDays,
  computeHoursPerDay,
  resolveGenerationMode,
} from './ai.strategy';

class AIService {
  private static instance: AIService;
  private openai: OpenAI;
  private model: string;

  constructor() {
    const httpAgent = createDevHttpsAgent();
    if (httpAgent) {
      logger.warn(
        'OpenAI TLS: certificate verification disabled in development. Set OPENAI_TLS_REJECT_UNAUTHORIZED=true in production.'
      );
    }
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      httpAgent: httpAgent,
    });
    this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  }

  static getInstance(): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService();
    }
    return AIService.instance;
  }

  /**
   * Hybrid plan generation: cache → online (if allowed) → offline fallback.
   * Always returns a plan; never throws on OpenAI quota/network failures.
   */
  async generatePlan(
    goalTitle: string,
    _goalDescription: string,
    targetDate: string,
    options: {
      intensity?: 'low' | 'medium' | 'high';
      weeklyHours?: number;
      language?: 'en' | 'ar';
      tone?: 'supportive' | 'professional' | 'casual';
    } = {},
    userId?: string
  ): Promise<GeneratedPlan> {
    const weeklyHours = options.weeklyHours ?? 10;
    const durationDays = computeDurationDays(targetDate);
    const hoursPerDay = computeHoursPerDay(weeklyHours);
    const goal = goalTitle.trim() || 'Goal';

    const cacheKey = generateCacheKey({ goal, durationDays, hoursPerDay });
    const cached = getCachedPlan(cacheKey);
    if (cached) {
      return cached;
    }

    const limit = userId ? checkAiDailyLimit(userId, false) : { forceOffline: false, allowed: true, count: 0, limit: 10 };
    const hasApiKey = Boolean(process.env.OPENAI_API_KEY?.trim());
    const mode = resolveGenerationMode({
      cacheHit: false,
      forceOffline: limit.forceOffline,
      hasApiKey,
    });

    let plan: GeneratedPlan;

    if (mode === 'offline') {
      plan = generateOfflinePlan({ goal, durationDays, hoursPerDay });
    } else {
      try {
        if (userId) {
          checkAiDailyLimit(userId, true);
        }
        plan = await this.generatePlanOnline({
          goal,
          durationDays,
          hoursPerDay,
          language: options.language ?? 'en',
        });
        logger.info('[AI OPENAI SUCCESS]', { goal: goal.substring(0, 60), durationDays, hoursPerDay });
      } catch (error) {
        logger.warn('[AI FALLBACK TRIGGERED]', {
          error: error instanceof Error ? error.message : String(error),
          goal: goal.substring(0, 60),
        });
        plan = generateOfflinePlan({ goal, durationDays, hoursPerDay });
      }
    }

    setCachedPlan(cacheKey, plan);
    return plan;
  }

  /** Minimal-token OpenAI call — only goal, duration, hoursPerDay */
  private async generatePlanOnline(input: {
    goal: string;
    durationDays: number;
    hoursPerDay: number;
    language: string;
  }): Promise<GeneratedPlan> {
    const system =
      input.language === 'ar'
        ? 'مخطط أهداف. JSON فقط: milestones[{title,target_date,duration_days,description}], tasks[{title,milestone_index,due_offset_days,duration_minutes,description}], notes.'
        : 'Goal planner. JSON only: milestones[{title,target_date,duration_days,description}], tasks[{title,milestone_index,due_offset_days,duration_minutes,description}], notes.';

    const user = JSON.stringify({
      goal: input.goal,
      durationDays: input.durationDays,
      hoursPerDay: input.hoursPerDay,
    });

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.6,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    return this.parseResponse(content);
  }

  private parseResponse(content: string): GeneratedPlan {
    try {
      let jsonString = '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonString = jsonMatch[0];
      } else {
        const arrayMatch = content.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          jsonString = `{"data": ${arrayMatch[0]}}`;
        } else {
          throw new Error('No JSON found in response');
        }
      }

      let cleanedJson = jsonString.replace(/,(\s*[}\]])/g, '$1').replace(/'/g, '"');

      let parsed;
      try {
        parsed = JSON.parse(cleanedJson);
      } catch {
        parsed = JSON.parse(jsonString);
      }

      return {
        milestones: this.validateMilestones(parsed.milestones || parsed.data?.milestones || []),
        tasks: this.validateTasks(parsed.tasks || parsed.data?.tasks || []),
        notes: parsed.notes || parsed.data?.notes || '',
      };
    } catch (error) {
      logger.error('Failed to parse AI response:', error);
      throw new Error(
        `Invalid response format from AI: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private validateMilestones(milestones: any[]): GeneratedMilestone[] {
    return milestones.map((milestone, index) => ({
      title: milestone.title || `Milestone ${index + 1}`,
      durationDays: Math.max(1, parseInt(milestone.duration_days) || 7),
      targetDate: milestone.target_date || milestone.targetDate || undefined,
      description: milestone.description || '',
      tasks: milestone.tasks || [],
    }));
  }

  private validateTasks(tasks: any[]): GeneratedTask[] {
    return tasks.map((task, index) => ({
      title: task.title || `Task ${index + 1}`,
      milestoneIndex: Math.max(0, parseInt(task.milestone_index) || 0),
      dueOffsetDays: Math.max(0, parseInt(task.due_offset_days) || 1),
      durationMinutes: Math.max(15, parseInt(task.duration_minutes) || 60),
      recurrence: task.recurrence || null,
      description: task.description || '',
    }));
  }

  async generateSimplePlan(goalTitle: string): Promise<GeneratedPlan> {
    return generateOfflinePlan({
      goal: goalTitle,
      durationDays: 21,
      hoursPerDay: 1.5,
    });
  }

  /** Motivational weekly review copy for shareable cards */
  async generateWeeklyReview(stats: {
    completedTasks: number;
    missedTasks: number;
    consistencyScore: number;
    bestDays: { date: string; completed: number }[];
  }): Promise<{
    insights: string[];
    recommendations: string[];
    shareableSummary: string;
  }> {
    const prompt = JSON.stringify({
      completed: stats.completedTasks,
      missed: stats.missedTasks,
      consistency: stats.consistencyScore,
      bestDays: stats.bestDays,
    });

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: 'Coach. JSON only: insights[], recommendations[], shareableSummary.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.8,
        max_tokens: 400,
        response_format: { type: 'json_object' },
      });
      const content = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
      logger.info('[AI OPENAI SUCCESS]', { feature: 'weeklyReview' });
      return {
        insights: parsed.insights || [],
        recommendations: parsed.recommendations || [],
        shareableSummary: parsed.shareableSummary || '',
      };
    } catch {
      logger.warn('[AI FALLBACK TRIGGERED]', { feature: 'weeklyReview' });
      return {
        insights: ['You showed up this week — that matters.'],
        recommendations: ['Choose one focus block tomorrow morning.'],
        shareableSummary: `${stats.consistencyScore}% consistency this week on Planora AI.`,
      };
    }
  }
}

export const aiService = AIService.getInstance();
