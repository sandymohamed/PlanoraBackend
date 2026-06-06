"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const joi_1 = __importDefault(require("joi"));
const database_1 = require("../../shared/utils/database");
const types_1 = require("../../shared/types");
const logger_1 = require("../../shared/utils/logger");
const posthog_1 = require("../../infrastructure/analytics/posthog");
const router = (0, express_1.Router)();
const ALLOWED_SOURCES = ['paywall', 'landing', 'popup', 'unknown'];
const waitlistSchema = joi_1.default.object({
    email: joi_1.default.string().trim().email().max(200).required(),
    source: joi_1.default.string()
        .trim()
        .lowercase()
        .valid(...ALLOWED_SOURCES)
        .default('unknown'),
});
/** POST /api/v1/waitlist — public premium waitlist signup */
router.post('/', async (req, res) => {
    const { error, value } = waitlistSchema.validate(req.body);
    if (error) {
        throw new types_1.ValidationError(error.details[0].message);
    }
    const prisma = (0, database_1.getPrismaClient)();
    // Idempotent per (email, source) — re-submitting is a no-op success.
    const lead = await prisma.waitlistLead.upsert({
        where: { email_source: { email: value.email, source: value.source } },
        update: {},
        create: { email: value.email, source: value.source },
    });
    (0, posthog_1.trackServerEvent)(value.email, 'waitlist_joined', { source: value.source });
    logger_1.logger.info('Waitlist signup', { id: lead.id, source: value.source });
    res.status(201).json({
        success: true,
        message: "You're on the list. We'll email you when Premium launches.",
    });
});
exports.default = router;
