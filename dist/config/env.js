"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.env = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT || 3001),
    isProduction: process.env.NODE_ENV === 'production',
    jwt: {
        secret: process.env.JWT_SECRET,
        refreshSecret: process.env.JWT_REFRESH_SECRET,
        expiresIn: process.env.JWT_EXPIRES_IN || '15m',
        refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    },
    // corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:8081').split(',').map((s) => s.trim()),
    corsOrigins: (process.env.CORS_ORIGIN || "*").split(',').map((s) => s.trim()),
    rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '120', 10),
        aiMaxPerWindow: parseInt(process.env.AI_RATE_LIMIT_MAX || '10', 10),
    },
    freemium: {
        freeMaxActiveGoals: parseInt(process.env.FREE_MAX_ACTIVE_GOALS || '3', 10),
        freeMaxAiPerMonth: parseInt(process.env.FREE_MAX_AI_GENERATIONS_PER_MONTH || '3', 10),
    },
    sentry: {
        dsn: process.env.SENTRY_DSN || '',
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
        tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.2'),
    },
    posthog: {
        apiKey: process.env.POSTHOG_API_KEY || '',
        host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
    },
    openrouter: {
        apiKey: process.env.OPENROUTER_API_KEY || '',
        primaryModel: process.env.OPENROUTER_MODEL_PRIMARY || 'x-ai/grok-4.3',
        fallbackModel: process.env.OPENROUTER_MODEL_FALLBACK || 'meta-llama/llama-3.3-70b-instruct',
        appName: process.env.OPENROUTER_APP_NAME || 'Planora AI',
        siteUrl: process.env.OPENROUTER_SITE_URL || '',
    },
};
