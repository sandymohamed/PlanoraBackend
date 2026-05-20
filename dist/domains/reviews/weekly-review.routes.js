"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../shared/middleware/auth");
const weekly_review_service_1 = require("./weekly-review.service");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken);
router.get('/', async (req, res) => {
    const reviews = await weekly_review_service_1.weeklyReviewService.listForUser(req.user.id);
    res.json({ success: true, data: reviews });
});
router.get('/current', async (req, res) => {
    const review = await weekly_review_service_1.weeklyReviewService.generateForUser(req.user.id);
    res.json({ success: true, data: review });
});
router.post('/generate', async (req, res) => {
    const review = await weekly_review_service_1.weeklyReviewService.generateForUser(req.user.id);
    res.json({ success: true, data: review });
});
exports.default = router;
