import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { setupExpressErrorHandler } from "@sentry/node";
import { env } from "./config/env";
import { errorHandler } from "./shared/middleware/errorHandler";

// MVP routes (individual productivity)
import authRoutes from "./domains/auth/auth.routes";
import userRoutes from "./domains/users/user.routes";
import taskRoutes from "./domains/tasks/task.routes";
import goalRoutes from "./domains/goals/goal.routes";
import routineRoutes from "./domains/routines/routine.routes";
import alarmRoutes from "./domains/alarms/alarm.routes";
import timerRoutes from "./domains/timers/timer.routes";
import reminderRoutes from "./domains/reminders/reminder.routes";
import aiRoutes from "./domains/ai/ai.routes";
import subscriptionRoutes from "./domains/subscription/subscription.routes";
import weeklyReviewRoutes from "./domains/reviews/weekly-review.routes";
import notificationRoutes from "./domains/users/notification.routes";
import contactRoutes from "./domains/contact/contact.routes";
import waitlistRoutes from "./domains/waitlist/waitlist.routes";
import healthRoutes from "./infrastructure/health/health.routes";
import { runHealthCheck } from "./infrastructure/health/healthCheck";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: "*",
      // origin: env.corsOrigins,
      // credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.set("trust proxy", 1);

  const limiter = rateLimit({
    windowMs: env.rateLimit.windowMs,
    max: env.rateLimit.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { message: "Too many requests" } },
  });
  app.use(limiter);

  const aiLimiter = rateLimit({
    windowMs: env.rateLimit.windowMs,
    max: env.rateLimit.aiMaxPerWindow,
    message: { success: false, error: { message: "AI rate limit exceeded" } },
  });

  app.use(express.json({ limit: "10mb" }));

  app.get("/health", async (_req, res) => {
    const health = await runHealthCheck();
    const code = health.status === "error" ? 503 : 200;
    res.status(code).json(health);
  });

  const v1 = "/api/v1";
  app.use(`${v1}/auth`, authRoutes);
  app.use(`${v1}/me`, userRoutes);
  app.use(`${v1}/tasks`, taskRoutes);
  app.use(`${v1}/goals`, goalRoutes);
  app.use(`${v1}/routines`, routineRoutes);
  app.use(`${v1}/alarms`, alarmRoutes);
  app.use(`${v1}/timers`, timerRoutes);
  app.use(`${v1}/reminders`, reminderRoutes);
  app.use(`${v1}/notifications`, notificationRoutes);
  app.use(`${v1}/ai`, aiLimiter, aiRoutes);
  app.use(`${v1}/subscription`, subscriptionRoutes);
  app.use(`${v1}/reviews`, weeklyReviewRoutes);
  app.use(`${v1}/contact`, contactRoutes);
  app.use(`${v1}/waitlist`, waitlistRoutes);
  // app.get(`${v1}/waitlist`, (req, res)=>{
  //   console.log('Waitlist signup attempt', { body: req.body });
  //   res.status(200).json({ success: true, data: { message: 'Waitlist is currently closed' } });
  // });
  app.use(`${v1}/health`, healthRoutes);

  // Collaboration, sync, analytics — archived (not mounted in MVP)
  // See src/future/collaboration/README.md

  setupExpressErrorHandler(app);
  app.use(errorHandler);

  return app;
}
