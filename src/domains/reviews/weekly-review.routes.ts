import { Router, Response } from 'express';
import { authenticateToken } from '../../shared/middleware/auth';
import { AuthenticatedRequest } from '../../shared/types';
import { weeklyReviewService } from './weekly-review.service';

const router = Router();
router.use(authenticateToken);

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const reviews = await weeklyReviewService.listForUser(req.user!.id);
  res.json({ success: true, data: reviews });
});

router.get('/current', async (req: AuthenticatedRequest, res: Response) => {
  const review = await weeklyReviewService.generateForUser(req.user!.id);
  res.json({ success: true, data: review });
});

router.post('/generate', async (req: AuthenticatedRequest, res: Response) => {
  const review = await weeklyReviewService.generateForUser(req.user!.id);
  res.json({ success: true, data: review });
});

export default router;
