# Dashboard performance benchmark

This suite compares a frozen pre-change dashboard with the current dashboard.
Both use the actual page and TanStack Query orchestration in an isolated,
production-built browser harness. The fixture API replaces server functions at
build time. No fixture route, fake authentication, or benchmark control is added
to the production app.
The harness excludes the production app shell and authentication guard. Its
navigation timings are component-harness measurements, not live-site load times.

## Repeat the comparison

```powershell
npm run benchmark:dashboard
node benchmarks/dashboard/report.mjs
```

Close other CPU-heavy work. The suite interleaves baseline and optimized samples
on the same machine, alternating which version goes first.
The suite requires installed Microsoft Edge and free localhost ports 4180 and 4181.
Playwright is a development dependency; it does not increase production JavaScript.
Each invocation overwrites both timing reports and saves completed groups as it
runs. Preliminary driver-timed results are retained separately and are not used
for acceptance.

The suite runs 10 measured repetitions and discards one warm-up per scenario.
Cold loads use fresh browser contexts with HTTP caching disabled. Cached/stale
returns reuse a warm context. Stale tests age query timestamps by 61 seconds;
details tests remove only the expanded-data queries before opening the panel.
The browser clock and timezone are fixed for deterministic weekly calculations.
Animation-frame probes measure DOM readiness inside the browser. Cold measurements
start at navigation; return measurements start just before the automated click
and include its dispatch overhead. Details are scrolled into view before
timing. Every sample waits for router and query settlement; stale runs assert the
expected request count so a delayed refresh cannot be silently omitted.

Mobile: 390 x 900, 150 ms latency, 1.6 Mbps download, 0.75 Mbps upload, 4x CPU
slowdown. Desktop: 1440 x 900 without throttling. Both use synthetic 0/20/100-match
accounts, with incomplete matches, singles/doubles, and viewer-relative results.
Fixture payloads are checked against the real projected server-reader output.

Ready time ends when the primary action, profile heading, and recent-match state
are rendered. Summary time additionally waits for XP (or expanded progress in the
details scenario). Data completion also includes the last fixture response.
Return readiness intentionally permits cached content while refresh continues.
Request counts and response bytes cover dashboard fixture APIs only. JavaScript
bytes are decoded response-body sizes for the isolated harness, not the main app.
The report compares the real production entry size separately.
Medians use the mean of the middle two values for ten samples; p90 uses nearest
rank. Supplemental request-to-data timings exclude document/module startup and
do not replace the full-navigation acceptance target.

These timings do not simulate database execution or auth latency. They measure
browser work and response transfer under controlled conditions. A live signed-in
check is separate, and fixture improvements must not be claimed as a measured
percentage improvement for every real account.

## Baseline provenance

`dashboard-source-baseline.json` records the pre-change Git revision, a SHA-256 of
tracked/non-ignored file paths and contents (including uncommitted work), and the
production entry size. `dashboard-baseline-source.json.gz` preserves the original
page and core-function source without retaining an executable old page in the app.
The benchmark build restores its page into ignored `dist/performance-baseline`.
Do not recapture the baseline when merely rerunning this comparison.

For a future performance pass, build the app first, then run
`npm run benchmark:dashboard:capture` **before editing requests**. That intentionally
replaces the historical snapshot and metadata. Commit/review those artifacts along
with the resulting comparison; never rewrite Lovable history to create a baseline.

## Correctness and live checks

`node benchmarks/dashboard/verify.mjs` checks pending/failed sections, retries,
saved goals, protected drafts, patch saves, layouts and cache returns against a
running optimized fixture server. Screenshots and interaction results are saved
under this directory. These are labeled synthetic data, not account screenshots.

To measure real request timing with the local production adapter:

```powershell
npm run build
$env:DASHBOARD_METRICS='1'
npm run preview
```

Sign in normally at http://127.0.0.1:4174/auth. Visit Dashboard, leave and return,
and open details. The adapter records only the two dashboard function names,
elapsed server time, response size, status, and timestamp in `dashboard-live.jsonl`.
It never records request parameters, response contents, tokens, or account IDs.
This local flag does not alter deployed handlers or weaken authorization.

For the existing signed-in development server, `/dashboard?dashboardMetrics=1`
enables local DOM-availability and resource-timing diagnostics. These diagnostics
are excluded from production. Reload without the flag to disable them. See
[live verification](dashboard-live-verification.md) for observations and
the outstanding measurement limitations; development timings are not a production
benchmark.

`node benchmarks/dashboard/live-report.mjs` regenerates the real-account report
from the privacy-filtered current and stale JSON files; these are separate from
the controlled fixture results. Return DOM timings start at route-loader entry,
and include no claim about full navigation or paint latency. Development query
and route-leave marks correlate intent-prefetched requests without changing cache
timestamps. One observed slow response and its measurement wait timeout are retained.

`node benchmarks/dashboard/metrics-regression.mjs` serves a synthetic probe-only
fixture on port 5183. Complete its summary, hot reload the diagnostic module ten
times, and open progress details; exactly one diagnostic panel should remain and
readiness should still update. This tests observer cleanup and never supplies an
authenticated session or contributes to the live-account measurements.
