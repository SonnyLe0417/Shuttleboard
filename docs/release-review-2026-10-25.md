# Bug fixes and offline scoring: release review

This is the earlier subset review. The later combined review in
`performance/combined-review-2026-10-25.md` also covers the previously excluded
startup/diagnostic work and records the subsequently authorized grouped commits.

## Scope and file selection

This review covers the eight pending bug fixes and offline scoring. It does not
authorize a commit, push, production migration, scheduler update or deployment.

The exact file inventory is `release-file-manifest-2026-10-25.json`. Its base is
commit `738c9dacf4e85184a0f3d3559e4b8c9f76c95a87`. It lists 71 complete files and
two files that require selected hunks. SHA-256 values identify the reviewed
candidate contents with CRLF normalized to LF; changes after this review require
rechecking that selection. Including the three review artifacts, the inventory
covers 76 paths; two require selected hunks rather than whole-file staging.

For `src/routes/__root.tsx`, include offline account events, the prepared-scoreboard
recovery exception and the static offline shell. Exclude the experimental
`virtual:startup-preloads` import and session modulepreload generation.

For `vite.config.ts`, include only the offline build plugin import, client entry
and build plugin registration. Exclude startup router/icon splitting and the
startup-preload plugin. `release-selected-hunks-2026-10-25.patch` contains the exact
two selected diffs against the base, without changing the live working files.
It uses zero-context hunks to avoid whitespace-only context lines in the patch
artifact; applying it requires `git apply --unidiff-zero`.

Also retain this review, its manifest and selected-hunks patch as review artifacts.
Do not use `git add .`: it would include unrelated experiments and old reports.

Exclude all other working-tree changes, notably:

- `docs/performance/**`, untracked `benchmarks/**`, and the changed scoring fixture
  `tests/fixtures/singles-match-1.json`.
- Dashboard timing/capture source and tests, changes to
  `dashboard-live-metrics.ts`, `dashboard.functions.ts`, `dashboard.server.ts`.
- Pending changes to `src/routes/auth.tsx` and
  `src/routes/_authenticated/route.tsx`.
- `scripts/startup-preloads.ts`, `src/startup-assets.d.ts`, `supabase/.temp/**`,
  generated builds, database runtime directories, caches and browser records.

Existing performance code already in the base commit remains present. The
decider-win correction in `dashboard-model.ts` and its corresponding expectations
in `tests/dashboard-performance.test.mjs` belong to this bug-fix release.

## Database advisors and real-role acceptance

Docker/WSL worked after restart. The isolated runner applied the repository's
migrations to a disposable local database, disabled cron before fake fixtures,
and passed actual-role/concurrency tests for quota admission and leases,
invitation ownership/atomicity/rollback, offline UUID collisions and receipts,
original play times and repeated reward events. It never linked a hosted project.

The CLI generates local container names in this version. The corrected runner
selects only a newly created `supabase_db_*` container on reserved port 55422,
refuses a pre-existing database/container, and stops the stack in `finally`.
Earlier container-name failures did not execute acceptance tests; the later
successful run and advisor run both passed the actual SQL checks.

All security and performance advisors ran locally, at INFO threshold, with their
raw JSON retained in `database-advisors-2026-10-25.json`:

| Level | Count | Interpretation |
| --- | ---: | --- |
| ERROR | 0 | No error-level advisor findings |
| WARN | 35 | Existing RLS policies reevaluate authentication per row |
| WARN | 2 | Existing duplicate match-team indexes |
| INFO | 4 | Foreign keys without covering indexes |
| INFO | 27 | Indexes unused in this fresh synthetic database |
| INFO | 3 | Private tables intentionally have RLS without client policies |

The private tables are `app_private.ai_vision_days`, `ai_vision_users` and
`notification_config`. Client access is intentionally denied; server operations
use narrowly granted privileged access. Adding client policies would weaken that
boundary. The new invitation-creation policy already uses `(SELECT auth.uid())`;
the RLS performance warnings concern other, previously defined policies. The
duplicate-index and missing-index findings are follow-up performance work, not
evidence to change scoring or ownership behavior. A fresh test database's unused
indexes are not evidence that production indexes should be removed.

No advisor finding is being represented as fixed or absent. Production has not
been inspected and may differ from the repository migrations.

## Validation of the selected release

The original working tree previously passed 188 JavaScript tests, 99 Python tests
plus the standalone transport check, typecheck, lint, normal production build and
route/bundle checks. The isolated production browser used fake auth and verified
offline reopening, two matches, retained dates, takeover and lost-response retry.

A separate ignored review copy was built from the base commit plus exactly the
manifest selection. It passed the normal production build, typecheck, lint (zero
errors, the same three existing Fast Refresh warnings), seven route checks and
production-client fixture/privileged-operation exclusion checks.

Its complete JavaScript suite ran 183 tests: **182 passed, zero failed, one
skipped**. The skipped test requires the immutable saved comparison builds, which
are deliberately not copied into this release review. That check passed earlier
in the main workspace. Five experiment-only dashboard capture/timing tests are
absent from this selected release, explaining the difference from 188 tests in
the full working tree. The real production offline browser test passed with the
selected root/Vite changes, so offline scoring does not depend on the excluded
startup experiments.

Initial review-copy failures were preparation issues, retained here explicitly:
the Git archive contained CRLF text that lint rejected (normalized only in the
review copy), and the first browser run failed to locate a configured public SDK
namespace because ignored environment files were not copied. The successful
build used synthetic public values instead:

```powershell
$env:VITE_SUPABASE_URL='https://offline-fixture.supabase.co'
$env:VITE_SUPABASE_PROJECT_ID='offline-fixture'
$env:VITE_SUPABASE_PUBLISHABLE_KEY='sb_publishable_offline_fixture_only'
npm run build
npm test
node scripts/check-bugfix-build.mjs
```

Browser interception blocks external requests; these are fixture values, not
working credentials. No real environment file or account session was copied.
The selected copy also passed all **99 Python tests** with one existing Starlette
deprecation warning, plus the standalone Python live-transport and Node frame-pump
checks. The correct Python commands are:

```sh
python -m pytest -q --ignore=scripts/test_tracknet_live.py -p no:cacheprovider
python scripts/test_tracknet_live.py
node scripts/test-live-frame-pump.cjs
```

An initial unfiltered pytest invocation passed 99 tests but failed on collecting
the standalone async transport function; it requires running as a script, not a
pytest test. Two sandbox-stalled Python attempts were stopped; the final checks
used the existing local environment outside the sandbox and completed.
The main saved baseline/optimized entry hashes remain unchanged. The local
advisor/test stack stopped successfully; no Docker containers remained afterward.

The selected bug-fix/offline contents are ready for a reviewed commit. Whole-file
staging of the two mixed files, or pushing all current changes, is not the reviewed
release. Production rollout remains a separate authorized operation with the
migration and scheduler ordering below.

## Release order (not executed)

1. Review this inventory and the selected-hunks patch; obtain authorization for
   the commit/push and separately for the production rollout. Pushing to the
   connected branch syncs to Lovable, so coordinate this with the migration.
2. Before releasing callers, apply only the new migration
   `20261025183506_secure_ai_and_invitation_transactions.sql` through the normal
   authorized migration process. Do not rewrite earlier migrations. Verify actual
   production function grants/RLS and run production advisors when authorized.
3. Configure existing server-only Supabase credentials through secret management,
   preserving provider/VAPID secrets. No service secret belongs in `VITE_*`.
4. Coordinate the three notification scheduler calls with the server release:
   they must use the existing private worker Bearer token. Keep the protected
   delivery worker and existing schedules/subscriptions. A mismatched scheduler
   will be rejected; queued counts are not delivery counts.
5. Release the reviewed normal build with matching worker, anonymous offline
   shell, manifest and assets. Preserve old working cache on failed preparation;
   never clear device queues, login state or force active scoring to reload.
6. Perform authorized smoke checks for AI rejection/quota behavior, invitations,
   chat/statistics and prepared offline scoring with a dedicated test account.
   No paid upstream calls are needed for automated validation.

Offline scoring needs no additional migration. If the migration is not available,
new AI admission fails closed and invitation responses fail rather than silently
using the old unsafe behavior. Rollback must preserve these security boundaries
and pending local matches; do not revert to anonymous paid API or public-key jobs.
