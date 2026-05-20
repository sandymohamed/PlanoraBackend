"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const env_1 = require("./config/env");
const errorHandler_1 = require("./shared/middleware/errorHandler");
const sentry_1 = require("./infrastructure/sentry/sentry");
// MVP routes (individual productivity)
const auth_routes_1 = __importDefault(require("./domains/auth/auth.routes"));
const user_routes_1 = __importDefault(require("./domains/users/user.routes"));
const task_routes_1 = __importDefault(require("./domains/tasks/task.routes"));
const goal_routes_1 = __importDefault(require("./domains/goals/goal.routes"));
const routine_routes_1 = __importDefault(require("./domains/routines/routine.routes"));
const alarm_routes_1 = __importDefault(require("./domains/alarms/alarm.routes"));
const timer_routes_1 = __importDefault(require("./domains/timers/timer.routes"));
const reminder_routes_1 = __importDefault(require("./domains/reminders/reminder.routes"));
const ai_routes_1 = __importDefault(require("./domains/ai/ai.routes"));
const subscription_routes_1 = __importDefault(require("./domains/subscription/subscription.routes"));
const weekly_review_routes_1 = __importDefault(require("./domains/reviews/weekly-review.routes"));
const notification_routes_1 = __importDefault(require("./domains/users/notification.routes"));
(0, sentry_1.initSentry)();
function createApp() {
    const app = (0, express_1.default)();
    app.use((0, helmet_1.default)());
    app.use((0, cors_1.default)({
        origin: env_1.env.corsOrigins,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    }));
    const limiter = (0, express_rate_limit_1.default)({
        windowMs: env_1.env.rateLimit.windowMs,
        max: env_1.env.rateLimit.maxRequests,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, error: { message: 'Too many requests' } },
    });
    app.use(limiter);
    const aiLimiter = (0, express_rate_limit_1.default)({
        windowMs: env_1.env.rateLimit.windowMs,
        max: env_1.env.rateLimit.aiMaxPerWindow,
        message: { success: false, error: { message: 'AI rate limit exceeded' } },
    });
    app.use(express_1.default.json({ limit: '10mb' }));
    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            product: 'Planora AI',
            timestamp: new Date().toISOString(),
        });
    });
    const v1 = '/api/v1';
    app.use(`${v1}/auth`, auth_routes_1.default);
    app.use(`${v1}/me`, user_routes_1.default);
    app.use(`${v1}/tasks`, task_routes_1.default);
    app.use(`${v1}/goals`, goal_routes_1.default);
    app.use(`${v1}/routines`, routine_routes_1.default);
    app.use(`${v1}/alarms`, alarm_routes_1.default);
    app.use(`${v1}/timers`, timer_routes_1.default);
    app.use(`${v1}/reminders`, reminder_routes_1.default);
    app.use(`${v1}/notifications`, notification_routes_1.default);
    app.use(`${v1}/ai`, aiLimiter, ai_routes_1.default);
    app.use(`${v1}/subscription`, subscription_routes_1.default);
    app.use(`${v1}/reviews`, weekly_review_routes_1.default);
    // Collaboration, sync, analytics — archived (not mounted in MVP)
    // See src/future/collaboration/README.md
    app.use(errorHandler_1.errorHandler);
    return app;
}
