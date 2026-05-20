# Planora Backend

Domain-driven Express API for **Planora AI**.

## Structure

```
src/
├── app.ts                 # Express app + route mounting
├── server.ts              # Bootstrap
├── config/env.ts          # Typed environment
├── domains/
│   ├── auth/
│   ├── goals/
│   ├── tasks/
│   ├── routines/
│   ├── alarms/
│   ├── timers/
│   ├── reminders/
│   ├── ai/
│   ├── reviews/           # AI Weekly Review
│   └── subscription/        # Freemium limits
├── shared/                  # middleware, errors, utils, types
├── infrastructure/          # Sentry, PostHog, BullMQ
└── future/collaboration/    # Archived team features
```

## API (MVP)

| Prefix | Features |
|--------|----------|
| `/api/v1/auth` | Signup, login, refresh (30d refresh tokens) |
| `/api/v1/me` | Profile, settings |
| `/api/v1/tasks` | CRUD, reorder, complete |
| `/api/v1/goals` | CRUD, milestones |
| `/api/v1/routines` | Habits, reset, routine tasks |
| `/api/v1/alarms` | Alarms, snooze, dismiss |
| `/api/v1/timers` | Focus timers |
| `/api/v1/ai` | Goal plan generation (rate limited) |
| `/api/v1/subscription` | Plan + limits |
| `/api/v1/reviews` | Weekly AI review |

## Security improvements vs legacy

- Refresh token TTL default **30 days** (not ~100 years)
- Separate **AI rate limiter**
- **Freemium** enforcement on goals + AI usage
- Collaboration routes **not mounted**

## npm install on Windows (SSL errors)

If you see `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, this project includes `.npmrc` with `strict-ssl=false` (common behind corporate proxies).

After a failed install, delete `node_modules` and `package-lock.json`, then run `npm install` again (only one install at a time).

Optional packages (install separately when registry works):

```bash
npm install @sentry/node posthog-node
```

## Setup

1. **Create `.env`** (Prisma only reads `.env`, not `.env.example`):
   ```powershell
   copy .env.example .env
   ```
   Then edit `DATABASE_URL`, `JWT_SECRET`, etc.

2. **Generate client** (if needed):
   ```powershell
   npm run db:generate:win-ssl
   ```

3. **Migrations** (requires reachable PostgreSQL):
   ```powershell
   npm run db:migrate
   ```
   Or apply without prompts: `npx prisma migrate deploy`

4. **Run API**
   - Development (no build): `npm run dev`
   - Production: `npm run build` then `npm start`

## Setup (migrations detail)

See `.env.example`. Run migrations after schema changes:

```bash
npx prisma migrate dev --name planora_extensions
```

## Sentry

Set `SENTRY_DSN` in `.env`. Initialized in `src/infrastructure/sentry/sentry.ts`.

## PostHog

Set `POSTHOG_API_KEY` for server-side events.
