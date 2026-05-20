"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../shared/middleware/auth");
const subscription_service_1 = require("./subscription.service");
const env_1 = require("../../config/env");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken);
/** GET /api/v1/subscription — current plan + usage */
router.get('/', async (req, res) => {
    const userId = req.user.id;
    const sub = await subscription_service_1.subscriptionService.getOrCreate(userId);
    res.json({
        success: true,
        data: {
            tier: sub.tier,
            expiresAt: sub.expiresAt,
            limits: {
                maxActiveGoals: env_1.env.freemium.freeMaxActiveGoals,
                maxAiPerMonth: env_1.env.freemium.freeMaxAiPerMonth,
            },
            isPremium: subscription_service_1.subscriptionService.isPremium(sub.tier),
        },
    });
});
/** POST /api/v1/subscription/upgrade — stub for payment integration */
router.post('/upgrade', async (req, res) => {
    // Integrate Stripe/RevenueCat in production
    res.json({
        success: true,
        data: {
            message: 'Premium upgrade flow — connect Stripe or RevenueCat',
            checkoutUrl: null,
        },
    });
});
exports.default = router;
