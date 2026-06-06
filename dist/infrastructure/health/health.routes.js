"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const email_service_1 = require("../../domains/auth/email.service");
const router = (0, express_1.Router)();
/**
 * GET /api/v1/health/email
 * Reports whether SMTP is configured and the connection verifies.
 * Returns { smtp: true|false }.
 */
router.get('/email', async (_req, res) => {
    const smtp = email_service_1.emailService.isConfigured() ? await email_service_1.emailService.verifyConnection() : false;
    res.json({ smtp });
});
exports.default = router;
