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
const contactSchema = joi_1.default.object({
    name: joi_1.default.string().trim().min(1).max(120).required(),
    email: joi_1.default.string().trim().email().max(200).required(),
    subject: joi_1.default.string().trim().min(1).max(200).required(),
    message: joi_1.default.string().trim().min(1).max(5000).required(),
});
/** POST /api/v1/contact — public contact form submission */
router.post('/', async (req, res) => {
    const { error, value } = contactSchema.validate(req.body);
    if (error) {
        logger_1.logger.error('Contact form validation error', { error });
        throw new types_1.ValidationError(error.details[0].message);
    }
    const prisma = (0, database_1.getPrismaClient)();
    const submission = await prisma.contactSubmission.create({
        data: {
            name: value.name,
            email: value.email,
            subject: value.subject,
            message: value.message,
        },
    });
    logger_1.logger.info('submission', submission);
    (0, posthog_1.trackServerEvent)(value.email, 'contact_submitted', {
        subject: value.subject,
    });
    logger_1.logger.info('Contact submission received', { id: submission.id, email: value.email });
    res.status(201).json({
        success: true,
        message: 'Thanks for reaching out. We will get back to you soon.',
    });
});
exports.default = router;
