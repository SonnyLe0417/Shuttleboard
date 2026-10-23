import { readFile, writeFile } from "node:fs/promises";
const load = async (name) => JSON.parse(await readFile(`docs/performance/${name}.json`, "utf8"));
const baseline = await load("dashboard-baseline"),
  optimized = await load("dashboard-optimized");
if (baseline.protocol !== optimized.protocol || !baseline.protocol?.startsWith("paired-v3"))
  throw new Error(
    "Use matching paired-v3 reports; preliminary protocols are not acceptance evidence.",
  );
const before = await load("dashboard-source-baseline"),
  after = await load("dashboard-production-size");
// Derive standard even-sample medians from raw samples; p90 uses nearest rank.
function median(values) {
  const sorted = values
    .filter((value) => value !== null && value !== undefined)
    .sort((a, b) => a - b);
  const n = sorted.length;
  return n ? (n % 2 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : null;
}
for (const report of [baseline, optimized]) {
  for (const row of report.results)
    for (const [field, key] of Object.entries({
      medianReadyMs: "readyMs",
      medianSummaryReadyMs: "summaryReadyMs",
      medianCompleteMs: "completeMs",
      medianDataReadyMs: "dataReadyMs",
      medianRequests: "requests",
      medianResponseBytes: "responseBytes",
      medianJavascriptBytes: "javascriptBytes",
    }))
      row[field] = median(row.samples.map((sample) => sample[key]));
  report.aggregation = "standard median (mean of middle two for even samples), nearest-rank p90";
  await writeFile(
    `docs/performance/dashboard-${report.version}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
}
const changes = optimized.results.map((next) => {
  const previous = baseline.results.find(
    (row) =>
      row.profile === next.profile && row.count === next.count && row.scenario === next.scenario,
  );
  if (!previous) throw new Error("Missing baseline scenario");
  return {
    profile: next.profile,
    count: next.count,
    scenario: next.scenario,
    baselineMedianMs: previous.medianReadyMs,
    optimizedMedianMs: next.medianReadyMs,
    improvementPercent: (1 - next.medianReadyMs / previous.medianReadyMs) * 100,
    baselineP90Ms: previous.p90ReadyMs,
    optimizedP90Ms: next.p90ReadyMs,
    baselineSummaryMs: previous.medianSummaryReadyMs ?? previous.medianCompleteMs,
    optimizedSummaryMs: next.medianSummaryReadyMs,
    baselineDataReadyMs: previous.medianDataReadyMs,
    optimizedDataReadyMs: next.medianDataReadyMs,
    baselineResponseBytes: previous.medianResponseBytes,
    optimizedResponseBytes: next.medianResponseBytes,
    baselineRequests: previous.medianRequests,
    optimizedRequests: next.medianRequests,
    baselineHarnessJavascriptBytes: previous.medianJavascriptBytes,
    optimizedHarnessJavascriptBytes: next.medianJavascriptBytes,
  };
});
const populatedMobile = changes.filter((row) => row.profile === "mobile" && row.count > 0);
const regressions = changes.filter((row) => row.improvementPercent < -10);
for (const row of regressions) {
  const a = baseline.results.find(
    (result) =>
      result.profile === row.profile &&
      result.count === row.count &&
      result.scenario === row.scenario,
  );
  const b = optimized.results.find(
    (result) =>
      result.profile === row.profile &&
      result.count === row.count &&
      result.scenario === row.scenario,
  );
  const differences = b.samples.map((sample, index) => sample.readyMs - a.samples[index].readyMs);
  row.investigation = {
    absoluteMedianIncreaseMs: row.optimizedMedianMs - row.baselineMedianMs,
    slowerPairs: differences.filter((value) => value > 0).length,
    pairedMedianDeltaMs: median(differences),
    requests: `${row.baselineRequests} to ${row.optimizedRequests}`,
    note:
      row.scenario === "details"
        ? "Details now mount on opening instead of at initial load; this can shift rendering work to this action. Fewer API requests rule out an added request waterfall as its cause."
        : row.scenario === "stale"
          ? "The optimized page refreshes both essential and summary data; the old page refreshed only core and retained stale matches. Readiness still permits cached data; inspect paired deltas and p90 for scheduling variability."
          : row.scenario === "cached"
            ? "Both versions use cached data with no requests. Compare paired deltas and p90: this concerns rendering/input-dispatch/frame scheduling, not server latency."
            : "Compare request-to-data timing against navigation timing: startup and paint can dominate even when payload transfer is smaller.",
  };
}
const acceptance = {
  completeMatrix:
    baseline.results.length === 24 &&
    optimized.results.length === 24 &&
    [...baseline.results, ...optimized.results].every(
      (row) => row.runs === 10 && row.samples.length === 10,
    ),
  twentyPercentEveryPopulatedMobileScenario:
    populatedMobile.length === 8 && populatedMobile.every((row) => row.improvementPercent >= 20),
  smallerPopulatedColdPayloads: changes
    .filter((row) => row.count > 0 && row.scenario === "cold")
    .every((row) => row.optimizedResponseBytes < row.baselineResponseBytes),
  entryNotIncreased: after.entryBytes <= before.entryBytes,
  staticInitialJavascriptNotIncreased:
    after.staticInitialJavascriptBytes <= before.staticInitialJavascriptBytes,
};
const summary = { acceptance, before, after, regressions, changes };
await writeFile(
  "docs/performance/dashboard-comparison.json",
  JSON.stringify(summary, null, 2) + "\n",
);
const f = (value) => Number(value).toFixed(1);
const rows = changes
  .map(
    (row) =>
      `| ${row.profile} | ${row.count} | ${row.scenario} | ${f(row.baselineMedianMs)} | ${f(row.optimizedMedianMs)} | ${f(row.improvementPercent)}% | ${f(row.baselineP90Ms)} → ${f(row.optimizedP90Ms)} | ${row.baselineResponseBytes} → ${row.optimizedResponseBytes} | ${row.baselineRequests} → ${row.optimizedRequests} |`,
  )
  .join("\n");
const live = await readFile("docs/performance/dashboard-live.jsonl", "utf8").catch(() => "");
let markdown = `# Dashboard performance comparison\n\nProduction-built isolated dashboard harness with fixed synthetic data; 10 samples per scenario after one discarded warm-up. Browser: ${optimized.browser}. See [protocol](README.md) and raw baseline/optimized JSON for reproducible settings.\n\n## Results\n\n| Profile | Matches | Scenario | Before median ms | After median ms | Improvement | p90 ms | API bytes | API requests |\n| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows}\n\nPositive percentages are faster; negative percentages are slower. Cached/stale readiness means usable cached content, not completion of its background refresh. The raw JSON also records summary readiness and response completion.\n\n## Acceptance\n\n${Object.entries(
  acceptance,
)
  .map(([key, value]) => `- ${key}: **${value ? "PASS" : "NOT MET"}**`)
  .join(
    "\n",
  )}\n\nMain entry: ${before.entryBytes.toLocaleString()} → ${after.entryBytes.toLocaleString()} bytes. Static initial import closure: ${before.staticInitialJavascriptBytes.toLocaleString()} → ${after.staticInitialJavascriptBytes.toLocaleString()} bytes. These uncompressed counts exclude dynamic route/intent loads. Harness JavaScript transfer is recorded separately and is not the main-app bundle.\n\n## Timing regressions and limits\n\n${regressions.length ? regressions.map((row) => `- ${row.profile}, ${row.count} matches, ${row.scenario}: ${f(-row.improvementPercent)}% slower (${f(row.investigation.absoluteMedianIncreaseMs)} ms); slower in ${row.investigation.slowerPairs}/10 paired samples, paired median delta ${f(row.investigation.pairedMedianDeltaMs)} ms. ${row.investigation.note} This performance gate remains flagged.`).join("\n") : "No scenario regressed more than 10% in this comparison."}\n\nFixture timing covers the real dashboard component, query orchestration, browser execution and controlled response transfer. It excludes the production app shell, real database execution, auth checks, and internet variability; it is not a measured percentage improvement for real accounts. Server requests remain authenticated and RLS-protected. No TrackNet settings or database migrations changed.\n\n## Live verification\n\n${live.trim() ? "Local production request measurements are recorded separately in dashboard-live.jsonl. Confirm UI correctness alongside those timings; a successful HTTP status alone does not prove the response contained valid application data." : "Pending the user's local sign-in. No fixture or mocked-auth run is counted as real-account verification."}\n\n## Correctness\n\n114 unit tests, including statistical parity, viewer orientation, latest-100 limits, saved preference patches, cache reuse and timezone boundaries. Browser fixture interaction results are in dashboard-interactions.json; all three layout preferences, independent retries and protected goal drafts are exercised. See the implementation notes for final build/typecheck/lint status. Nothing was pushed or deployed.\n`;
const dataRows = changes
  .filter((row) => row.scenario === "cold")
  .map(
    (row) =>
      "| " +
      row.profile +
      " | " +
      row.count +
      " | " +
      f(row.baselineDataReadyMs) +
      " | " +
      f(row.optimizedDataReadyMs) +
      " |",
  )
  .join("\n");
markdown = markdown.replace(
  "## Acceptance",
  "## Request pipeline (supplementary)\n\nFrom the first dashboard API request to primary-content paint; excludes document/module startup. This helps explain the request optimization, and does not replace the full-navigation acceptance target above.\n\n| Profile | Matches | Before data-ready ms | After data-ready ms |\n| --- | ---: | ---: | ---: |\n" +
    dataRows +
    "\n\n## Acceptance",
);
const liveObservations = await readFile("docs/performance/dashboard-live-observations.json", "utf8")
  .then(() => true)
  .catch(() => false);
if (liveObservations)
  markdown = markdown.replace(
    "Pending the user's local sign-in. No fixture or mocked-auth run is counted as real-account verification.",
    "Signed-in development-server observations are recorded in [live verification](dashboard-live-verification.md). The controlled production real-account matrix remains unverified. No fixture or mocked-auth run is counted as real-account verification.",
  );
await writeFile("docs/performance/dashboard-comparison.md", markdown);
console.log(JSON.stringify({ acceptance, regressions: regressions.length }, null, 2));
