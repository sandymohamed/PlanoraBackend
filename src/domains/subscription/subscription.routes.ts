import { Router, Response } from 'express';
import { authenticateToken } from '../../shared/middleware/auth';
import { AuthenticatedRequest } from '../../shared/types';
import { subscriptionService } from './subscription.service';
import { env } from '../../config/env';

const router = Router();
router.use(authenticateToken);

/** GET /api/v1/subscription — current plan + usage */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const sub = await subscriptionService.getOrCreate(userId);
  res.json({
    success: true,
    data: {
      tier: sub.tier,
      expiresAt: sub.expiresAt,
      limits: {
        maxActiveGoals: env.freemium.freeMaxActiveGoals,
        maxAiPerMonth: env.freemium.freeMaxAiPerMonth,
      },
      isPremium: subscriptionService.isPremium(sub.tier),
    },
  });
});

/** POST /api/v1/subscription/upgrade — stub for payment integration */
router.post('/upgrade', async (req: AuthenticatedRequest, res: Response) => {
  // Integrate Stripe/RevenueCat in production
  res.json({
    success: true,
    data: {
      message: 'Premium upgrade flow — connect Stripe or RevenueCat',
      checkoutUrl: null,
    },
  });
});

export default router;
