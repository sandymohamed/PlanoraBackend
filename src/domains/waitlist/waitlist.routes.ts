import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { getPrismaClient } from '../../shared/utils/database';
import { ValidationError } from '../../shared/types';
import { logger } from '../../shared/utils/logger';
import { trackServerEvent } from '../../infrastructure/analytics/posthog';

const router = Router();

const ALLOWED_SOURCES = ['paywall', 'landing', 'popup', 'unknown'] as const;

const waitlistSchema = Joi.object({
  email: Joi.string().trim().email().max(200).required(),
  source: Joi.string()
    .trim()
    .lowercase()
    .valid(...ALLOWED_SOURCES)
    .default('unknown'),
});

/** POST /api/v1/waitlist — public premium waitlist signup */
router.post('/', async (req: Request, res: Response) => {

  console.log('lol Waitlist signup', { body: req.body });

  const { error, value } = waitlistSchema.validate(req.body);
  console.log("WAITLIST ERROR:", error)
  console.log("WAITLIST VALUE:", value)
  if (error) {
    throw new ValidationError(error.details[0].message);
  }

  const prisma = getPrismaClient();

  // Idempotent per (email, source) — re-submitting is a no-op success.
  const lead = await prisma.waitlistLead.upsert({
    where: { email_source: { email: value.email, source: value.source } },
    update: {},
    create: { email: value.email, source: value.source },
  });

  trackServerEvent(value.email, 'waitlist_joined', { source: value.source });

  logger.info('Waitlist signup', { id: lead.id, source: value.source });

  res.status(201).json({
    success: true,
    message: "You're on the list. We'll email you when Premium launches.",
  });
});

export default router;
