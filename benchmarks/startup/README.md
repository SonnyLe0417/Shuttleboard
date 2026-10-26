# Local startup benchmark

Uses the real production homepage and a separate production-mode full-app build
for dashboard fixtures. The fixture build runs the actual Supabase SDK locally
without persistent storage, refresh tokens, credentials, or real auth traffic.
Session retrieval adds a fixed 40 ms delay; fixture RPC handlers add 20 ms.
Dataset sizes are 0, 20 and 100 matches from the existing deterministic fixtures.
The app shell, session hook, protected route guard, onboarding cache, dashboard
loader, components and query orchestration come from the app source.

Capture once, before changing startup source, with `node benchmarks/startup/capture.mjs`.
The script refuses to overwrite any existing baseline build or provenance. It snapshots the current
production output, source fingerprint, source archive and lockfile. Historical
dashboard benchmark baselines are untouched.

Normal production builds use `npm run build`. Build the fixture variant separately
with `node node_modules/vite/bin/vite.js build --config benchmarks/startup/vite.config.mjs`.
Copy outputs into `dist/startup/{baseline,optimized}/{production,fixture}` before
building another variant. Never deploy the fixture output. Finish with a normal
production build and scan it for adapter markers.

Run `benchmarks/startup/server.mjs` with `STARTUP_ROOT` selecting a saved output and
`PORT` selecting 4190/4192 for normal baseline/optimized builds, or 4191/4193 for
fixture builds. Enable `STARTUP_FIXTURES=1` only on fixture servers. All listeners
bind to 127.0.0.1. JavaScript, CSS and HTML use gzip; static assets allow HTTP caching.

Run `node benchmarks/startup/run.mjs` for the baseline, or set
`STARTUP_VERSION=optimized` for the comparison. Defaults to ten measured runs and
one discarded warmup per scenario. `STARTUP_SMOKE=1` and `STARTUP_RUNS=1` produce a
separate smoke report. `STARTUP_RESUME=1` skips fully recorded scenarios when
continuing the same unchanged baseline; it must not be used after app changes.
The benchmark creates its own isolated browser contexts and never uses a personal
browser profile or copies a signed-in session.

Cold runs use new contexts. Homepage warm reloads retain HTTP cache. Dashboard
cached returns navigate through Rules and Home, preserving the query cache.
No cache timestamps are altered. Live external fonts remain enabled; network and
page failures are retained. Mobile uses 390×900, 150 ms latency, 200,000 bytes/s
download, and 4× CPU slowdown; desktop uses 1440×900 without throttling.

Run `node benchmarks/startup/budget.mjs` for each version to read public SSR
documents and calculate the union of emitted module preloads and their static
imports. This includes route-specific initial JavaScript for both entry URLs.
Generate comparison artifacts with `node benchmarks/startup/report.mjs`.

`STARTUP_CONFIRM=1` runs a separately labeled mobile homepage cold confirmation
for the selected version, again with ten repetitions and a discarded warmup.
The accepted confirmation was scheduled before inspecting results because
validation briefly overlapped the first optimized homepage scenario. Both the
original matrix and confirmation are retained; neither overwrites the other.

Real-account production observations require a separate user sign-in on the
preview origin. They are not inferred from synthetic results. Only timing, count,
size and fixed-label metadata belongs in reports; never save account content,
tokens, cookies, raw request parameters or screenshots of account data.

## Signed-in measurement hook

In Bash, start the saved baseline on the existing login origin:

```bash
PORT=8080 STARTUP_ROOT=dist/startup/baseline/production STARTUP_MEASURE=1 node benchmarks/startup/server.mjs
```

Reload localhost:8080/dashboard, keep Chrome visible, and use the local panel's
Measure reload and Measure cached-return buttons. Each schedules one warmup and
ten measured navigations; failures stop the batch and are retained. Use
localhost:8080/__startup-measure to select the other saved build on the same
origin. This control rejects cross-origin posts and unknown build values.

Each saved build runs in a separate Node worker with a fixed root. Switching waits
for initialization; a failed switch leaves the working build selected. Each request
keeps its runtime, build label, and measurement setting until its response completes.
Build fingerprints hash saved server and public file paths and contents. Worker
application logs are discarded to avoid logging account data. Stopping the preview
terminates its workers and rejects outstanding requests.

Export measurements downloads timing-only JSON. Copy it to
docs/performance/startup-account-measurements.json and run
`node benchmarks/startup/account-report.mjs` to generate the report and summary.
The report excludes warmups, manual checks, backgrounded samples and failures
from successful timing statistics while retaining every raw record.

Before finishing, export, click Clear local measurements, then choose Finish on
optimized without measurement from the control page. For a process with no
measurement controls, restart with STARTUP_MEASURE unset and STARTUP_ROOT set to
dist/startup/optimized/production. Never clear other browser storage. The hook
is server-injected only; saved build files and normal production bundles remain
unchanged. See startup-account-report.md for the incomplete real-account run.

Protocol 2 pauses automatically when a document becomes hidden or the viewport
changes. In-progress samples retain `backgrounded` or `viewport-changed`
classifications and do not advance the batch. Restore the original viewport,
select the tab, and click Resume visible run. Becoming visible never resumes
requests automatically. The first batch locks the viewport across both builds.
The export now uses `startup-account-foreground-measurements.json`; keep it
separate from the original account export. Protocol 2 records are labeled in
each sample. Prior incomplete sessions and reports remain unchanged.

### Bounded rerun (protocol 3)

New runs have session IDs, batch IDs and sample indices. The cap is 20 minutes
from the first batch or 80 dashboard navigations across both builds, including
preparation and retries. Pausing never resets these limits. Reaching a limit
stops automatic navigation; export before clearing diagnostics for a new session.

Starting a cached-return batch automatically reloads the dashboard to prepare
fresh data; this preparation is not a measured return. The batch has a conservative
40-second window from preparation completion. If a pause expires that window,
Resume retains the old batch as incomplete and starts a new preparation with a
different batch ID. Do not mix old and restarted batches in comparisons.

Failed preparation is retained even though its reload has `scheduled=false`.
Timeouts and interruptions end that batch and expose export/restart controls without
requiring dashboard readiness. Restarting creates a new batch ID while preserving
the session clock, navigation count, and previous records. Genuine visibility or
viewport interruptions still pause and require explicit resume.

Generate separate reports without modifying the historical report:

```bash
node benchmarks/startup/foreground-report.mjs docs/performance/startup-account-foreground-measurements.json docs/performance/startup-account-foreground
```

The generator refuses existing output files. It selects the first protocol-3
session and first complete batch per scenario, requires a discarded warmup plus
ten unique successful indices at matching viewports, and flags regressions above
10%. Use a different input/output prefix for another rerun. Keep all raw records.

### Isolated collector browser verification

Before another account run, execute `node benchmarks/startup/verify-collector.mjs
docs/performance/startup-collector-browser-NEW.json` with a new output filename.
This uses a temporary empty Edge profile and a loopback-only synthetic page;
it does not load the app or an account. It verifies eleven actual reloads and
cached returns, outgoing synthetic lifecycle-event orderings, genuine resize and
hide behavior, explicit resume, freshness and shared caps. It requires a desktop
where actual browser hiding is observable. The JSON retains failures and exits
unsuccessfully unless all checks pass. Never substitute unit or simulated event
results for the genuine-hide check. See startup-collector-recovery-2026-10-24.md
for historical verification failures retained locally. The subsequent full
manual-hide suite passed seven checks; the real-account comparison remains
incomplete and establishes no production speedup.

To diagnose hiding without repeating the other checks, append `--visibility-only`.
If the browser's minimize command does not produce a genuine hidden state, append
`--manual-visibility` as well. The separate synthetic Edge window waits at Start
check; click it, immediately minimize that window for two seconds, then restore
it. The test requires a browser-generated (`isTrusted`) hidden event, an invalidated
sample, no automatic resume, and successful explicit resume. It never fabricates
visibility for this check. A focused pass is not a full-suite pass; run the complete
suite with `--manual-visibility` and a new output filename before collecting account
measurements. The browser window is intentionally shown for this interactive test.

### Automated recovery regressions

After a normal production build, run:

```bash
node benchmarks/startup/verify-recovery.mjs docs/performance/startup-bugfix-browser-NEW.json
```

This uses an empty headless Edge context and blocks external browser requests. It
checks auth import/setup failures, Reload and storage preservation, public content,
the protected dashboard guard, and a real preparation timeout followed by a complete
cached-return batch. The timeout takes about 30 seconds. Existing output filenames
are rejected. `--protected-only` runs just the protected-route import/reload check.
These checks do not replace the separate genuine-hide browser verification.

### Preserve earlier outputs

Every runner/report command refuses an existing default output. Set
`STARTUP_OUTPUT=docs/performance/startup-NEW.json` for another synthetic run or
budget. Resume requires both `STARTUP_RESUME=1` and that explicit output path,
with the same version and run count. Warmups are retained separately from
measured samples. This does not change the signed-in collector's shared
20-minute/80-navigation cap or authorize another account measurement.

Report generators accept new prefixes instead of overwriting historical reports:

```sh
node benchmarks/startup/report.mjs docs/performance/startup-comparison-NEW
node benchmarks/startup/account-report.mjs INPUT.json docs/performance/startup-account-NEW
node benchmarks/dashboard/capture-report.mjs INPUT.json docs/performance/dashboard-summary-NEW
node benchmarks/startup/verify.mjs docs/performance/startup-interactions-NEW.json
```

`account-report.mjs` is only for historical schema-1 exports. Current foreground
eligibility must use `foreground-report.mjs`; it checks warmups, indices, caps,
visibility, viewport, failures and freshness. Raw account exports, collector
attempts, baseline source archives and large full-matrix traces remain local and
ignored. Reviewed small summaries are versioned; preserving a file locally does
not require publishing it.

See `docs/performance/combined-review-2026-10-25.md` for the current review and
limitations. Historical Markdown reports under `docs/performance/startup-*`
remain local so their raw-export links and incomplete attempts stay intact.
