# Eight bug fixes: local validation and rollout

The isolated database acceptance checks passed after the Windows restart on
October 25, 2026. Local database advisors also completed: zero ERROR findings,
37 performance WARN findings and 34 INFO findings. See the advisor JSON and
release review for interpretation. Separately authorized rollout remains
outstanding. No production migrations or scheduler changes
have been applied. Saved startup builds and historical measurements are inputs,
not outputs of this work.

## Change inventory

These files belong to this fix. Other working-tree performance experiments and
historical reports remain separate.

- AI: `src/lib/vision-access.server.ts`, `src/lib/vision-request.ts`,
  `src/routes/api/ai-vision.ts`, `src/routes/_authenticated/ai.tsx`,
  `src/routes/_authenticated/video.tsx`.
- Notifications: `src/lib/notification-worker.server.ts`,
  `src/lib/notification-jobs.server.ts`, the queue helper in
  `src/lib/progress.server.ts`, `src/routes/api/public/hooks/notifications.ts`.
- Invitations and profile totals: `src/lib/invitations.server.ts`,
  `src/lib/growth.functions.ts`, `src/lib/public-profile-stats.server.ts`.
- Scoring: `src/lib/match-controller.ts`, `src/hooks/useBadmintonMatch.ts`.
- Chat and dashboard totals: `src/lib/message-history.ts`,
  `src/hooks/useMessageHistory.ts`, `src/lib/social.functions.ts`,
  `src/routes/_authenticated/social.tsx`, `src/lib/dashboard-model.ts`.
- Database: new migration
  `supabase/migrations/20261025183506_secure_ai_and_invitation_transactions.sql`,
  `tests/database/run-local.mjs`, `tests/database/verify.mjs`,
  `tests/database/.gitignore`, `tests/database/local/supabase/config.toml`,
  `tests/database/local/supabase/.gitignore`, and pinned CLI changes in
  `package.json` / `package-lock.json`.
- Regression checks: `tests/vision-access.test.mjs`, `tests/vision-route.test.mjs`,
  `tests/notification-jobs.test.mjs`, `tests/invitation-boundary.test.mjs`,
  `tests/match-controller.test.mjs`, `tests/match-controller-browser.test.mjs`,
  `tests/message-history.test.mjs`, `tests/message-functions.test.mjs`,
  `tests/result-statistics.test.mjs`, `tests/fixtures/load-runtime.mjs`,
  `tests/fixtures/match-controller-browser.mjs`,
  `tests/dashboard-performance.test.mjs`, `scripts/check-bugfix-build.mjs`,
  and this rollout document. The dashboard test corrects only the decider-win
  expectations; historical benchmark fixture formulas are unchanged.

Verified October 25, 2026: 175 JavaScript tests, 99 pytest tests and the standalone
live-transport test pass. Typecheck, production build and seven route smoke checks
pass. Lint has zero errors and three existing Fast Refresh warnings. The
production-client check finds neither test/collector fixtures nor privileged
quota/config operations. The subsequent offline-scoring suite passed 188 JavaScript
tests. The isolated Postgres runner now passes actual-role, quota/concurrency,
invitation transaction and offline-save ownership/idempotency/reward assertions.
Local database advisors have now run; their warnings are documented in
`release-review-2026-10-25.md` and the complete output is preserved in
`database-advisors-2026-10-25.json`.

## Local database acceptance (passed)

With Docker Desktop running, repeat from the repository root:

```sh
node tests/database/run-local.mjs
```

The runner copies migrations to ignored `tests/database/.runtime`, uses project
`shuttleboard-bugfix-tests` and ports 55420–55429, and refuses to reuse an existing
test container or occupied database port. Because this CLI generates local
container identifiers, it selects only a newly created Supabase database on
reserved port 55422. It cannot accept a remote database URL or project reference. It
does not read application `.env` files. Do not link this project to a hosted
project or copy real accounts, tokens, VAPID keys, or data into it.

Historical migrations create the notification cron job. There is no delivery
configuration in this empty test database; the runner disables cron before
inserting fixtures. Tests use fake auth users and real database roles, concurrent
psql connections, and a forced invitation-write error. The runner stops its own
test stack without retaining database volumes. If startup/cleanup fails, inspect
that isolated project before retrying; do not delete other Docker resources.

`node tests/database/run-local.mjs --prepare` only copies configuration and
migrations. A successful prepare is **not** a passing database test.

## Validation commands

```sh
npm test
npm run typecheck
npm run lint
npm run build
node scripts/check-bugfix-build.mjs
```

The JavaScript suite includes an isolated browser using actual React Strict Mode
and the voice controller. It uses a new synthetic browser context, not the user's
signed-in Chrome session. Run the Python suites using the existing TrackNet v3
virtual environment as before. Windows asyncio uses loopback sockets internally;
a sandbox blocking those sockets can stall the tests before any application code.

## Future rollout sequence (requires separate authorization)

1. Pass local database acceptance, inspect actual function privileges/RLS, and
   run database advisors. Review the new migration
   `20261025183506_secure_ai_and_invitation_transactions.sql`; never rewrite
   published migrations. Keep the existing match-access policies narrow.
2. Apply that new migration through the normal authorized production process
   before releasing application callers that depend on its RPCs. Until then,
   quota admission fails closed and invitation responses fail rather than
   falsely report success. Deploying new server code first will pause paid AI
   and prevent invitation responses.
3. Supply server-only `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY` through the existing secret configuration.
   Preserve the existing paid provider secret. Never put privileged credentials
   in a `VITE_` variable or client bundle.
4. Optional server settings are positive integers:
   `AI_VISION_USER_MINUTE_LIMIT=60`, `AI_VISION_USER_DAY_LIMIT=1000`, and
   `AI_VISION_GLOBAL_DAY_LIMIT=10000`. Daily counters reset at midnight UTC.
   Admission reserves a request slot for 60 seconds; the 45-second upstream
   deadline and completion cleanup release it earlier. Denied admission never
   calls the paid provider. Auth and daily-limit failures stop paid frame
   sampling until an explicit new analysis; temporary limits respect Retry-After.
5. Update the existing reminder, weekly-summary and inactivity schedulers to use
   `Authorization: Bearer <existing private notification worker token>` on the
   application hook. Obtain it through the existing secret-management workflow;
   do not paste it into commands, repository files, logs, or chat. Remove the old
   publishable-key header. Preserve existing schedules and job query values
   `reminders`, `weekly`, and `inactivity`.
6. Keep the existing protected delivery worker and its schedule. Keep the stored
   VAPID keys and subscriptions unchanged. The application hook now reports
   `queued`, with `sent: 0`; queue admission does not mean push delivery.
   Stable per-user/event keys and legacy notification-log checks suppress repeats.
7. Smoke-check normal scoring, local tracking, signed-in AI rejection messages,
   invitations, chat pagination and public-profile statistics after authorized
   rollout. Do not clear login storage or use paid API calls as automated tests.

## Rollback considerations

Keep the authentication and notification authorization boundaries in place.
Rolling back to the old anonymous paid endpoint or public-key job authorization
reopens the reported vulnerabilities. Do not drop private quota tables or restore
direct client invitation UPDATE grants as a shortcut. If a regression occurs,
pause the affected feature and diagnose it with synthetic data before an
authorized corrective release.
