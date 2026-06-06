import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { getPrismaClient } from '../../shared/utils/database';
import { ValidationError } from '../../shared/types';
import { logger } from '../../shared/utils/logger';
import { trackServerEvent } from '../../infrastructure/analytics/posthog';

const router = Router();

const contactSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  email: Joi.string().trim().email().max(200).required(),
  subject: Joi.string().trim().min(1).max(200).required(),
  message: Joi.string().trim().min(1).max(5000).required(),
});

/** POST /api/v1/contact — public contact form submission */
router.post('/', async (req: Request, res: Response) => {
  const { error, value } = contactSchema.validate(req.body);
  if (error) {
    logger.error('Contact form validation error', { error });
    throw new ValidationError(error.details[0].message);
  }

  const prisma = getPrismaClient();
  const submission = await prisma.contactSubmission.create({
    data: {
      name: value.name,
      email: value.email,
      subject: value.subject,
      message: value.message,
    },
  });

  logger.info('submission', submission);

  trackServerEvent(value.email, 'contact_submitted', {
    subject: value.subject,
  });

  logger.info('Contact submission received', { id: submission.id, email: value.email });

  res.status(201).json({
    success: true,
    message: 'Thanks for reaching out. We will get back to you soon.',
  });
});

export default router;
