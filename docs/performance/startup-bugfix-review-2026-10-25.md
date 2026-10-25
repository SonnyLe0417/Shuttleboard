# Startup bug-fix review and commit scope — 2026-10-25

The three fixes are ready to commit using the exact scope below. The full working
tree also contains earlier performance and diagnostic work; it is not the proposed
commit. No commit, staging, push or deployment was performed.

## Findings corrected

1. The auth recovery boundary did not observe session failures when an eager route
   dependency or page subscription failed before normal content mounted. Import
   failures on sign-in and Settings, plus the sign-in setup case, reproduced the
   missing Reload action. The root error component now subscribes to the same session
   store and shows Error + Reload. The expanded tests also cover password reset.
2. The browser test's subscription mock previously failed SDK initialization instead
   of subscription setup. It also assumed exactly one SDK export. The corrected test
   preserves all real exports and client initialization, wraps factories, and throws
   specifically from onAuthStateChange. Every subscription case asserts that this
   injection was actually reached. Earlier reports' subscription labels are superseded
   by the corrected evidence linked below; the unit subscription tests remain valid.
3. An isolated commit needs two existing auth-loading dependencies: the protected
   guard must defer the SDK import, and the SDK group must use
   includeDependenciesRecursively=false. Omitting either can make an SDK download
   failure block browser bootstrap before recovery can render. Generated import
   graphs and failed isolated checks confirmed both dependencies. Their minimal
   hunks are included; navigation prefetching and other bundling changes are excluded.

Worker isolation, failure retention and cached-return preparation handling had no
additional confirmed defects. A new coordinator shutdown regression verifies that
an outstanding HTTP request settles and close is idempotent. Existing lifecycle,
visibility, freshness, eligibility and shared-cap tests remain intact.

## Checks

| Scope                                        | Result                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| Complete working-tree unit/integration suite | 150 passed; 0 failed; 0 skipped                                         |
| Exact fix-only copy based on HEAD            | 144 passed; 0 failed; 1 expected skip                                   |
| Corrected working-build browser suite        | 16/16 passed                                                            |
| Exact fix-only build browser suite           | 16/16 passed                                                            |
| Typecheck                                    | Passed for working tree and final fix-only copy                         |
| Lint                                         | Both scopes: 0 errors; three existing Fast Refresh warnings             |
| Normal production builds                     | Passed for working tree and final fix-only copy                         |
| Route smoke checks                           | Five routes per build; HTTP 200 and all referenced JavaScript available |
| Production exclusion scans                   | Collector, fixture and capture-panel markers absent in both builds      |
| Saved comparison builds                      | Not rebuilt; saved server entry hashes unchanged                        |

The isolated copy has no saved comparison builds, so its saved-build integration
test is deliberately skipped. The same test passed in the main working tree using
the original saved builds. Its other tests run against synthetic builds. The isolated
app build uses synthetic configuration, not copied credentials. No timings from
these verification runs establish an app speed improvement.

Authoritative browser evidence:

- [Working build](startup-bugfix-review-browser-corrected-2026-10-25.json)
- [Exact commit selection](startup-bugfix-review-scope-browser-ready-2026-10-25.json)
- [Route, bundle and saved-hash checks](startup-bugfix-review-builds-ready-2026-10-25.json)

Failed and incomplete attempts are retained. The first scoped browser run stopped at
an export-shape assertion. The next two were stopped after repeated bootstrap failures
identified the omitted dependencies; observed failures were reconstructed from terminal
output and explicitly marked interrupted, with remaining cases incomplete. No collector
scenario had started in those interrupted runs. They are not counted as passes.

## Exact commit files

Include these 24 source/test files. Three require selective contents:

- src/routes/__root.tsx: include session/recovery changes; exclude the virtual preload
  import, SSR preload links and the associated head argument change.
- vite.config.ts: include only includeDependenciesRecursively=false and its explanatory
  comment in the existing supabase-client group. Exclude startup-router/startup-icons
  groups, startupPreloads import and plugin registration.
- src/routes/_authenticated/route.tsx: include the loader import and awaited SDK load;
  exclude the ClubNavigation prefetch and its comment.

```text
benchmarks/startup/build-runtime.mjs
benchmarks/startup/build-worker.mjs
benchmarks/startup/server.mjs
benchmarks/startup/measure-server.mjs
benchmarks/startup/measure-client.js
benchmarks/startup/verify-recovery.mjs
benchmarks/startup/verify-collector.mjs
benchmarks/startup/foreground-report.mjs
src/components/SessionRecovery.tsx
src/hooks/useSession.ts
src/lib/session-store.ts
src/lib/browser-supabase.ts
src/lib/deferred-subscription.ts
src/lib/attach-browser-auth.ts
src/start.ts
src/routes/__root.tsx
src/routes/scoreboard.tsx
src/routes/_authenticated/route.tsx
vite.config.ts
tests/startup-build-switch.test.mjs
tests/startup-measure.test.mjs
tests/startup-run-limits.test.mjs
tests/startup-subscription.test.mjs
tests/startup-foreground-report.test.mjs
```

Include these 17 validation/evidence files, retaining failed attempts:

```text
docs/performance/startup-bugfix-validation-2026-10-25.md
docs/performance/startup-bugfix-browser-2026-10-24-attempt1.json
docs/performance/startup-bugfix-browser-2026-10-25-attempt2.json
docs/performance/startup-bugfix-protected-2026-10-25.json
docs/performance/startup-bugfix-review-auth-before-2026-10-25.json
docs/performance/startup-bugfix-review-auth-after-2026-10-25.json
docs/performance/startup-bugfix-review-browser-2026-10-25.json
docs/performance/startup-bugfix-review-browser-corrected-2026-10-25.json
docs/performance/startup-bugfix-review-scope-browser-2026-10-25.json
docs/performance/startup-bugfix-review-scope-browser-corrected-2026-10-25.json
docs/performance/startup-bugfix-review-scope-browser-final-2026-10-25.json
docs/performance/startup-bugfix-review-scope-browser-ready-2026-10-25.json
docs/performance/startup-bugfix-review-scope-guard-probe-2026-10-25.json
docs/performance/startup-bugfix-review-builds-ready-2026-10-25.json
docs/performance/startup-bugfix-review-builds-final-2026-10-25.json
docs/performance/startup-bugfix-review-builds-2026-10-25.json
docs/performance/startup-bugfix-review-2026-10-25.md
```

A patch containing precisely these selected contents is available locally at
dist/review/bugfix-scope-2026-10-25/bugfix-only.patch. It passes git apply --check
against an untouched HEAD copy with an explicit work-tree root. This patch is a
review artifact for a clean HEAD checkout, not a patch to reapply over the already
modified working tree. The isolated candidate directory contains the tested contents.
The temporary review scripts/copies and patch are not commit files.

The first lint run on the archived copy reported 28,132 CRLF formatting errors.
The archive had converted previously unchanged LF files to CRLF. Only the isolated
copy's text line endings were normalized before rerunning lint; no working-tree
files or additional commit contents were changed for this environment artifact.

## Earlier work left out

Leave these pending for a separate review:

- src/routes/auth.tsx: the earlier duplicate-navigation/pending-invitation race fix.
- scripts/startup-preloads.ts, src/startup-assets.d.ts and the other preload/bundling
  hunks in vite.config.ts and __root.tsx.
- src/lib/dashboard-live-metrics.ts, dashboard.functions.ts, dashboard.server.ts,
  dashboard-capture.ts, dashboard-capture.client.ts, dashboard-timing.ts and
  dashboard-timing.server.ts; their dashboard tests, capture report script and reports.
- docs/performance/README.md and benchmarks/startup/README.md, which mix earlier work.
- Other startup benchmark/report scripts, historical measurement/report JSON, baseline
  source archives, saved builds and generated output. The exact allowlist above is
  intentionally narrower than either untracked directory.

## Limits and preserved state

No signed-in benchmark, live backend test or manual visibility cycle was run. Public
profile responses were synthetic. Genuine-hide assertions were not weakened. Account
storage, prior results and saved comparison builds were preserved. Personal Chrome
and the existing localhost:8080 process were not operated or restarted; their state
was not reverified. Temporary test contexts, servers and workers closed after passing
runs. Interrupted runs are marked as incomplete. No database change, speed optimization,
commit, push, deployment or published-history rewrite occurred.
