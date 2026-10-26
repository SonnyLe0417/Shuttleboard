import { readFileSync } from "node:fs";
import { assertNewOutputs, writeNewReport } from "./output.mjs";
const folder = "docs/performance/";
const prefix = process.argv[3] ?? folder + "startup-account";
assertNewOutputs([prefix + "-summary.json", prefix + "-report.md"]);
const data = JSON.parse(
  readFileSync(process.argv[2] ?? folder + "startup-account-measurements.json", "utf8"),
);
if (data.schema !== 1 || data.samples?.some((sample) => sample.protocol >= 2))
  throw Error(
    "Legacy reports accept schema-1 records only; use foreground-report.mjs for current protocol eligibility.",
  );
function stats(values) {
  const a = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    n: a.length,
    median: a.length ? (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2 : null,
    p90: a.length ? a[Math.ceil(a.length * 0.9) - 1] : null,
    max: a.at(-1) ?? null,
  };
}
const rows = [];
for (const build of ["baseline", "optimized"])
  for (const scenario of ["reload", "cached-return"]) {
    const all = data.samples.filter((s) => s.build === build && s.scenario === scenario);
    const valid = all.filter(
      (s) => s.scheduled && !s.warmup && s.classification === "complete" && !s.backgrounded,
    );
    rows.push({
      build,
      scenario,
      total: all.length,
      backgrounded: all.filter((s) => s.backgrounded).length,
      timeouts: all.filter((s) => s.classification === "timeout").length,
      interrupted: all.filter((s) => s.classification === "interrupted").length,
      knownErrors: all.reduce((n, s) => n + s.failures + s.resourceErrors, 0),
      completeProtocol: valid.length === 10,
      metrics: Object.fromEntries(
        [
          "readyMs",
          "summaryMs",
          "requests",
          "exposedTransferBytes",
          "javascriptTransferBytes",
          "hookSetupMs",
        ].map((k) => [k, stats(valid.map((s) => s[k]))]),
      ),
    });
  }
writeNewReport(
  prefix + "-summary.json",
  JSON.stringify(
    { schema: 1, comparisonComplete: rows.every((r) => r.completeProtocol), rows },
    null,
    2,
  ) + "\n",
);
writeNewReport(
  prefix + "-report.md",
  `# Signed-in local measurement investigation

The opt-in hook ran against the saved production builds at localhost:8080 in the existing signed-in Chrome tab. No session was copied and no account data was changed. All ${data.samples.length} exported samples are retained in [raw measurements](startup-account-measurements.json), including warmups, manual checks, backgrounded attempts and timeouts.

| Build | Scenario | Total recorded | Eligible completed samples | Median ms | p90 ms | Maximum ms | Backgrounded | Timeouts |
|---|---|---:|---:|---:|---:|---:|---:|---:|
${rows.map((r) => `| ${r.build} | ${r.scenario} | ${r.total} | ${r.metrics.readyMs.n} | ${r.metrics.readyMs.median?.toFixed(1) ?? "missing"} | ${r.metrics.readyMs.p90?.toFixed(1) ?? "missing"} | ${r.metrics.readyMs.max?.toFixed(1) ?? "missing"} | ${r.backgrounded} | ${r.timeouts} |`).join("\n")}

## Interpretation

**The requested before/after protocol is incomplete. No signed-in speedup is established.** Backgrounded documents were throttled, and browser automation stalled repeatedly during reloads. The export itself completed successfully to Downloads, although the browser connection failed while awaiting its completion. The raw export was recovered intact from that file.

The optimized cached-return observations are slower than the available baseline observations. This is an unresolved observation, not a controlled regression conclusion: sample counts differ, visibility and viewport changed, the host was not controlled, and document age/cache freshness differs. Returned UI may show cached data while a stale refresh runs. Do not infer database or authentication latency from these DOM timings. A clean, stable-foreground repeat is still required.

The first collector version continued marking the last sample backgrounded after completion. The stored flag is retained conservatively; one baseline cached-return sample was therefore excluded. This bug is fixed for future runs. Changes to export controls and panel reattachment during preflight did not change readiness definitions. Manual preflight entries are excluded using the scheduled flag.

## Measurement boundaries

Readiness is the first animation frame observing the actual dashboard essential-data marker, relative to document start or the captured Home click. Summary completion is recorded separately. Resources are collected through 800 ms after both markers are observed; resource counts include available completed entries, not every initiated network request. Zero transfer sizes can mean HTTP cache or unavailable cross-origin data; exposed byte sums are partial and must not be described as total network traffic. Browser errors and failed resource elements are counted, but failed fetches and HTTP failures are not exhaustively observable by this hook.

Hook setup durations are recorded. Injection, polling, JSON persistence and the diagnostic panel also add overhead that was not isolated, so setup duration is not total instrumentation cost. No LCP, precise server spans, authentication spans, or database speedup is claimed. Detailed medians, p90s and maxima for summary, counts and exposed sizes are in [summary JSON](startup-account-summary.json).

## Cleanup

The preview is left serving the optimized saved build at port 8080 with STARTUP_MEASURE disabled. Browser session diagnostic storage could not be cleared because browser access stopped responding; it contains only bounded timing metadata and remains available for recovery. The next document reload has no injected hook. Login storage was never read, copied, or removed. No changes were pushed or deployed.

## Validation

All 126 unit tests pass, including origin enforcement, injection order, interrupted and missing timings, marker detection, privacy, storage bounds and completed-sample visibility freezing. Typecheck, lint and the normal production build pass; lint retains three existing Fast Refresh warnings. An isolated fixture browser completed a warmup and ten reloads plus a warmup and ten cached returns without page errors. The account baseline also showed no hydration errors before sampling. Same-origin build switching preserved the signed-in dashboard. The final server returned HTTP 200 without injection and HTTP 404 for the disabled measurement control; the normal production client bundle contains no hook or fixture markers. Browser-side storage cleanup and a complete valid account comparison remain unfinished.
`,
);
console.log(
  JSON.stringify(
    rows.map((r) => ({
      build: r.build,
      scenario: r.scenario,
      eligible: r.metrics.readyMs.n,
      median: r.metrics.readyMs.median,
    })),
  ),
);
