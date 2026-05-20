"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiService = void 0;
const openai_1 = __importDefault(require("openai"));
const logger_1 = require("../../shared/utils/logger");
class AIService {
    constructor() {
        this.openai = new openai_1.default({
            apiKey: process.env.OPENAI_API_KEY,
        });
        this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    }
    static getInstance() {
        if (!AIService.instance) {
            AIService.instance = new AIService();
        }
        return AIService.instance;
    }
    async generatePlan(goalTitle, goalDescription, targetDate, options = {}) {
        try {
            const { intensity = 'medium', weeklyHours = 10, language = 'en', tone = 'supportive', } = options;
            const prompt = this.buildPrompt(goalTitle, goalDescription, targetDate, {
                intensity,
                weeklyHours,
                language,
                tone,
            });
            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: 'system',
                        content: this.getSystemPrompt(language),
                    },
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                temperature: 0.7,
                max_tokens: 2000,
            });
            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error('No response from OpenAI');
            }
            return this.parseResponse(content);
        }
        catch (error) {
            logger_1.logger.error('Failed to generate AI plan:', error);
            // Handle specific OpenAI errors
            if (error?.code === 'model_not_found' || error?.status === 404) {
                const fallbackMessage = `OpenAI model "${this.model}" is unavailable. Set OPENAI_MODEL to a valid model (e.g. "gpt-4o-mini") or verify your API access.`;
                throw new Error(fallbackMessage);
            }
            // Re-throw parse errors as-is (they already have meaningful messages from parseResponse)
            if (error instanceof Error && (error.message.includes('parse') || error.message.includes('Invalid response format') || error.message.includes('JSON'))) {
                throw error;
            }
            // Wrap other errors with a user-friendly message
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            throw new Error(`AI service error: ${errorMessage}`);
        }
    }
    buildPrompt(goalTitle, goalDescription, targetDate, options) {
        const { intensity, weeklyHours, language, tone } = options;
        if (language === 'ar') {
            return `
الهدف: "${goalTitle}"
الوصف: "${goalDescription}"
التاريخ المستهدف: ${targetDate}
الكثافة: ${intensity}
الساعات الأسبوعية: ${weeklyHours}
النبرة: ${tone}

يرجى إنشاء خطة مفصلة لتحقيق هذا الهدف مع:
- معالم واضحة وقابلة للقياس
- مهام عملية ومحددة
- جدول زمني واقعي
- تذكيرات مناسبة
- ملاحظات مفيدة

تأكد من أن الخطة مناسبة للمستوى المطلوب والوقت المتاح.
      `.trim();
        }
        return `
Goal: "${goalTitle}"
Description: "${goalDescription}"
Target Date: ${targetDate}
Intensity: ${intensity}
Weekly Hours: ${weeklyHours}
Tone: ${tone}

Please create a detailed plan to achieve this goal with:
- Clear, measurable milestones
- Practical, specific tasks
- Realistic timeline
- Appropriate reminders
- Helpful notes

Make sure the plan is suitable for the requested level and available time.
    `.trim();
    }
    getSystemPrompt(language) {
        if (language === 'ar') {
            return `
أنت خبير في التخطيط الشخصي والمهني. مهمتك هي تحويل الأهداف إلى خطط عمل مفصلة ومنظمة.

يجب أن ترد دائماً بصيغة JSON صالحة مع المفاتيح التالية:
- "milestones": مصفوفة من المعالم مع {title, target_date (تنسيق ISO YYYY-MM-DD), duration_days (كبديل), description, tasks}
- "tasks": مصفوفة مسطحة من المهام مع {title, milestone_index, due_offset_days, duration_minutes, recurrence, description}
- "notes": نص مفيد إضافي

قواعد مهمة:
1. اجعل المهام عملية وقابلة للتنفيذ
2. استخدم فترات زمنية واقعية
3. رتب المهام بترتيب منطقي
4. أضف تذكيرات مناسبة للمهام المهمة
5. استخدم نبرة داعمة ومحفزة
6. تأكد من أن الخطة قابلة للتحقيق في الوقت المحدد
7. للمعالم: قدم target_date بتنسيق ISO (YYYY-MM-DD) لكل معلم. يجب توزيع التواريخ بالتساوي من اليوم حتى تاريخ الهدف. يجب أن ينتهي آخر معلم في تاريخ الهدف أو قبله.
      `.trim();
        }
        return `
You are an expert personal and professional planner. Your task is to convert goals into detailed, structured action plans.

You must always respond with valid JSON format containing these keys:
- "milestones": array of milestones with {title, target_date (ISO format YYYY-MM-DD), duration_days (as fallback), description, tasks}
- "tasks": flattened array of tasks with {title, milestone_index, due_offset_days, duration_minutes, recurrence, description}
- "notes": additional helpful text

Important rules:
1. Make tasks practical and actionable
2. Use realistic timeframes
3. Order tasks in logical sequence
4. Add appropriate reminders for important tasks
5. Use supportive and motivating tone
6. Ensure the plan is achievable within the given timeframe
7. For milestones: Provide target_date in ISO format (YYYY-MM-DD) for each milestone. Dates should be distributed evenly from today to the goal target date. The last milestone should end on or before the goal target date.
    `.trim();
    }
    parseResponse(content) {
        try {
            // Clean the response to extract JSON - try multiple strategies
            let jsonString = '';
            // Strategy 1: Try to find JSON object in the response
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                jsonString = jsonMatch[0];
            }
            else {
                // Strategy 2: Try to find JSON array
                const arrayMatch = content.match(/\[[\s\S]*\]/);
                if (arrayMatch) {
                    jsonString = `{"data": ${arrayMatch[0]}}`;
                }
                else {
                    throw new Error('No JSON found in response');
                }
            }
            // Try to fix common JSON issues before parsing
            let cleanedJson = jsonString
                // Remove trailing commas before closing brackets/braces
                .replace(/,(\s*[}\]])/g, '$1')
                // Fix single quotes to double quotes (basic cases)
                .replace(/'/g, '"');
            let parsed;
            try {
                parsed = JSON.parse(cleanedJson);
            }
            catch (parseError) {
                // If cleaning didn't work, try original string
                try {
                    parsed = JSON.parse(jsonString);
                }
                catch (secondError) {
                    logger_1.logger.error('JSON parse error details:', {
                        originalError: parseError,
                        cleanedError: secondError,
                        jsonLength: jsonString.length,
                        preview: jsonString.substring(0, 500)
                    });
                    throw new Error('Failed to parse JSON response from AI');
                }
            }
            // Validate and structure the response
            const plan = {
                milestones: this.validateMilestones(parsed.milestones || parsed.data?.milestones || []),
                tasks: this.validateTasks(parsed.tasks || parsed.data?.tasks || []),
                notes: parsed.notes || parsed.data?.notes || '',
            };
            return plan;
        }
        catch (error) {
            logger_1.logger.error('Failed to parse AI response:', error);
            throw new Error(`Invalid response format from AI: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    validateMilestones(milestones) {
        return milestones.map((milestone, index) => ({
            title: milestone.title || `Milestone ${index + 1}`,
            durationDays: Math.max(1, parseInt(milestone.duration_days) || 7), // Fallback
            targetDate: milestone.target_date || milestone.targetDate || undefined, // AI-generated date
            description: milestone.description || '',
            tasks: milestone.tasks || [],
        }));
    }
    validateTasks(tasks) {
        return tasks.map((task, index) => ({
            title: task.title || `Task ${index + 1}`,
            milestoneIndex: Math.max(0, parseInt(task.milestone_index) || 0),
            dueOffsetDays: Math.max(0, parseInt(task.due_offset_days) || 1),
            durationMinutes: Math.max(15, parseInt(task.duration_minutes) || 60),
            recurrence: task.recurrence || null,
            description: task.description || '',
        }));
    }
    // Generate a simple plan for testing
    async generateSimplePlan(_goalTitle) {
        return {
            milestones: [
                {
                    title: 'Getting Started',
                    durationDays: 7,
                    description: 'Initial setup and planning phase',
                    tasks: ['Research and gather information', 'Set up tools and resources'],
                },
                {
                    title: 'Core Development',
                    durationDays: 21,
                    description: 'Main work phase',
                    tasks: ['Implement core features', 'Test and iterate'],
                },
                {
                    title: 'Finalization',
                    durationDays: 7,
                    description: 'Completion and review',
                    tasks: ['Final testing', 'Documentation', 'Deployment'],
                },
            ],
            tasks: [
                {
                    title: 'Research and gather information',
                    milestoneIndex: 0,
                    dueOffsetDays: 1,
                    durationMinutes: 120,
                    recurrence: undefined,
                    description: 'Spend time researching the topic thoroughly',
                },
                {
                    title: 'Set up tools and resources',
                    milestoneIndex: 0,
                    dueOffsetDays: 3,
                    durationMinutes: 90,
                    recurrence: undefined,
                    description: 'Prepare all necessary tools and resources',
                },
                {
                    title: 'Implement core features',
                    milestoneIndex: 1,
                    dueOffsetDays: 1,
                    durationMinutes: 180,
                    recurrence: 'RRULE:FREQ=DAILY;COUNT=14',
                    description: 'Work on the main features daily',
                },
                {
                    title: 'Test and iterate',
                    milestoneIndex: 1,
                    dueOffsetDays: 15,
                    durationMinutes: 120,
                    recurrence: 'RRULE:FREQ=WEEKLY;COUNT=3',
                    description: 'Regular testing and improvement cycles',
                },
                {
                    title: 'Final testing',
                    milestoneIndex: 2,
                    dueOffsetDays: 1,
                    durationMinutes: 240,
                    recurrence: undefined,
                    description: 'Comprehensive final testing',
                },
                {
                    title: 'Documentation',
                    milestoneIndex: 2,
                    dueOffsetDays: 3,
                    durationMinutes: 120,
                    recurrence: undefined,
                    description: 'Create comprehensive documentation',
                },
                {
                    title: 'Deployment',
                    milestoneIndex: 2,
                    dueOffsetDays: 5,
                    durationMinutes: 90,
                    recurrence: undefined,
                    description: 'Deploy the final solution',
                },
            ],
            notes: 'This is a sample plan. Adjust the timeline and tasks based on your specific needs and available time.',
        };
    }
    /** Motivational weekly review copy for shareable cards */
    async generateWeeklyReview(stats) {
        const prompt = `You are Planora AI, a warm productivity coach. Given weekly stats:
- Completed tasks: ${stats.completedTasks}
- Missed tasks: ${stats.missedTasks}
- Consistency score: ${stats.consistencyScore}%
- Best days: ${JSON.stringify(stats.bestDays)}

Respond ONLY with JSON:
{"insights":["..."],"recommendations":["..."],"shareableSummary":"one inspiring sentence for social sharing"}`;
        try {
            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: 'Supportive, motivating, not robotic. JSON only.' },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.8,
                max_tokens: 600,
            });
            const content = response.choices[0]?.message?.content || '{}';
            const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
            return {
                insights: parsed.insights || [],
                recommendations: parsed.recommendations || [],
                shareableSummary: parsed.shareableSummary || '',
            };
        }
        catch {
            return {
                insights: ['You showed up this week — that matters.'],
                recommendations: ['Choose one focus block tomorrow morning.'],
                shareableSummary: `${stats.consistencyScore}% consistency this week on Planora AI.`,
            };
        }
    }
}
exports.aiService = AIService.getInstance();
