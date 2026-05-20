# Planora Backend Architecture

## Principles

1. **Domain folders** — each feature owns routes + services.
2. **Shared kernel** — auth middleware, Prisma, logger, error types.
3. **Infrastructure** — cross-cutting: queues, Sentry, PostHog.
4. **Future archive** — collaboration code kept but disabled for MVP.

## Request lifecycle

```
HTTP Request
  → helmet, cors, rateLimit
  → domain router (Joi validation)
  → authenticateToken (except /auth)
  → service or Prisma
  → { success, data } JSON
  → errorHandler on failure
```

## Freemium

`SubscriptionService` checks:

- Active goals ≤ 3 (FREE)
- AI usage logs per calendar month ≤ 5 (FREE)

Premium bypasses both.

## Weekly Review pipeline

1. Aggregate tasks + routine completions for ISO week.
2. Compute consistency score.
3. Call `AIService.generateWeeklyReview` (or fallback copy).
4. Persist `WeeklyReview` row for shareable card API.

## Data model additions

- `UserSubscription` — FREE | PREMIUM
- `AIUsageLog` — audit + billing
- `WeeklyReview` — insights JSON + shareableSummary

## Migration from Manage Time App

Logic ported from `backend/src/routes/*` and `services/*` with import path updates. Prisma schema is compatible; run new migration for Planora tables.

Collaboration tables remain in schema for DB compatibility but APIs are archived.
