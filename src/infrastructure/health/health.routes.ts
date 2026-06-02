import { Router, Request, Response } from 'express';
import { emailService } from '../../domains/auth/email.service';

const router = Router();

/**
 * GET /api/v1/health/email
 * Reports whether SMTP is configured and the connection verifies.
 * Returns { smtp: true|false }.
 */
router.get('/email', async (_req: Request, res: Response) => {
  const smtp = emailService.isConfigured() ? await emailService.verifyConnection() : false;
  res.json({ smtp });
});

export default router;
