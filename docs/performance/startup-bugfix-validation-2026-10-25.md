# Three startup bug fixes — validation

Implemented build-runtime isolation, authentication Error + Reload recovery, and
terminal cached-return preparation failures. No app speed improvement is claimed.

## Implementation

- The preview coordinator delegates each saved build to its own worker. Switching
  waits for initialization and retains the working selection on failure. Requests
  capture the runtime, artifact fingerprint, label and collection setting before
  asynchronous work. Request bodies and multiple Set-Cookie headers are forwarded;
  application logs are discarded. Worker exit rejects outstanding requests and
  preview shutdown terminates workers, including pending initialization.
- The session store exposes `error: Error | null` and reports import/setup failures
  without publishing a signed-out session or retrying automatically. Auth-dependent
  content shows Reload; homepage, Rules and public profiles retain usable public
  content with an inline message. The existing public-profile read bypasses the
  client token-loading middleware by compiled function ID; protected RPCs and server
  auth checks are unchanged. Scoreboard trial consumption waits for a successful
  session result. Reload calls `window.location.reload()` without deleting storage.
- Preparation timeout/interruption stops the batch despite `scheduled=false`, cancels
  timers and retains failure metadata. Export/restart controls appear even without
  readiness markers. A new batch retains the original session clock and navigation
  count. Visibility/resize pauses, explicit resume, freshness, eligibility and shared
  20-minute/80-navigation caps remain enforced.

## Verification

- Complete unit/integration suite: **149 passed, 0 failed, 0 skipped**.
- Saved production builds: baseline → optimized → baseline → optimized restored
  their asset sets; every referenced JavaScript URL returned HTTP 200. Synthetic
  build tests also verify stable distinct identities, server-file hashing, failed
  switches, in-flight labeling, request bodies, cookies, crashes and shutdown.
- TypeScript check: passed.
- Lint: 0 errors; the existing three Fast Refresh warnings remain in
  BadmintonMatchProvider, TrackNetAnalysisProvider and ui/button.
- Normal production build: passed. Saved comparison builds were not rebuilt.
- Route smoke checks: `/`, `/dashboard`, `/scoreboard`, `/settings`, `/auth` each
  returned HTTP 200 with no missing referenced JavaScript or injected collector.
- Normal client and server JavaScript scans found no collector storage/control,
  fixture endpoint, synthetic-account or summary-capture panel/export markers.
- Real headless Edge recovery checks: **9/9 passed** in
  [browser attempt 2](startup-bugfix-browser-2026-10-25-attempt2.json), plus **1/1**
  [protected dashboard check](startup-bugfix-protected-2026-10-25.json). Tests used
  empty contexts, synthetic storage and blocked external browser requests.
- The real 30-second preparation timeout exposed export without readiness. Its
  failure remained in the output. A new batch completed one discarded warmup and
  ten valid cached returns, preserving its session ID/start and advancing the shared
  navigation count from 4 to 17 across the failure, preparation and returns.

The earlier [failed browser attempt](startup-bugfix-browser-2026-10-24-attempt1.json)
is retained. It exposed an inline Reload button covered by the fixed sidebar;
placing the message inside the content area corrected that issue. Its fake-clock
collector retry was also unsuitable across document reloads; the passing check uses
a real timeout instead. No visibility assertions were weakened.

Saved server entry SHA-256 checks remain unchanged:

- Baseline: `2FC0B20EA3D339765BC24CDE8EEC4E83215946E4FFF1795CE26D8252DAE2D394`
- Optimized: `397F0FCB1C440199A61E2D29356BC0DCE8462ED4FCC8413BAFA32DEA93FEE20D`

## Limits and preserved state

No signed-in benchmark or manual measurement cycle was run. The existing genuine
visibility browser checks were retained; this change was checked with focused unit
coverage rather than another manual hiding cycle. Public-profile browser data was
stubbed, so live backend availability and signed-in timing remain outside this result.
Historical outputs and account storage were not edited. The existing localhost:8080
process and personal browser were left untouched; their current state was not
reverified. All temporary test servers/workers/browser contexts closed successfully.
No push, deployment, database change or published-history rewrite was performed.
