import { readFileSync, appendFileSync } from "node:fs";
import { assertNewOutputs, writeNewReport } from "./output.mjs";
import { improvementPercent, meetsReadinessTarget } from "./statistics.mjs";
const root = "docs/performance/";
const prefix = process.argv[2] ?? root + "startup-comparison";
assertNewOutputs([prefix + ".json", prefix + ".md"]);
const before = JSON.parse(readFileSync(root + "startup-baseline.json", "utf8")),
  after = JSON.parse(readFileSync(root + "startup-optimized.json", "utf8"));
function stats(values) {
  const a = values.filter(Number.isFinite).sort((a, b) => a - b),
    n = a.length;
  return {
    n,
    median: n ? (a[Math.floor((n - 1) / 2)] + a[Math.floor(n / 2)]) / 2 : null,
    p90: n ? a[Math.ceil(n * 0.9) - 1] : null,
    max: n ? a[n - 1] : null,
  };
}
const rows = before.results.map((base) => {
  const opt = after.results.find(
    (x) =>
      x.profile === base.profile &&
      x.kind === base.kind &&
      x.scenario === base.scenario &&
      x.count === base.count,
  );
  if (!opt) throw Error("Missing optimized scenario");
  const metrics = {};
  for (const metric of [
    "readyMs",
    "summaryMs",
    "lcpMs",
    "cls",
    "requests",
    "transferBytes",
    "javascriptBytes",
    "fixtureRequests",
  ]) {
    const b = stats(base.samples.map((x) => x[metric])),
      a = stats(opt.samples.map((x) => x[metric]));
    metrics[metric] = {
      baseline: b,
      optimized: a,
      improvementPercent: improvementPercent(b, a),
    };
  }
  const required =
    base.profile === "mobile" &&
    base.scenario === "cold" &&
    (base.kind === "homepage" || [20, 100].includes(base.count));
  return {
    profile: base.profile,
    kind: base.kind,
    count: base.count ?? null,
    scenario: base.scenario,
    required,
    passed:
      !required ||
      meetsReadinessTarget(
        metrics.readyMs,
        base.samples.filter((s) => s.failure || s.pageErrors || s.failedRequests).length,
        opt.samples.filter((s) => s.failure || s.pageErrors || s.failedRequests).length,
      ),
    baselineFailures: base.samples.filter((x) => x.failure).length,
    optimizedFailures: opt.samples.filter((x) => x.failure).length,
    baselinePageErrors: base.samples.reduce((a, x) => a + (x.pageErrors ?? 0), 0),
    optimizedPageErrors: opt.samples.reduce((a, x) => a + (x.pageErrors ?? 0), 0),
    baselineNetworkFailures: base.samples.reduce((a, x) => a + (x.failedRequests ?? 0), 0),
    optimizedNetworkFailures: opt.samples.reduce((a, x) => a + (x.failedRequests ?? 0), 0),
    regressions: ["readyMs", "lcpMs"].filter((name) => metrics[name].improvementPercent < -10),
    metrics,
  };
});
writeNewReport(
  prefix + ".json",
  JSON.stringify({ protocol: before.protocol, rows }, null, 2) + "\n",
);
const table = rows
  .map(
    (r) =>
      `| ${r.profile} ${r.kind} ${r.count ?? ""} ${r.scenario} | ${r.metrics.readyMs.baseline.median?.toFixed(1)} | ${r.metrics.readyMs.optimized.median?.toFixed(1)} | ${r.metrics.readyMs.improvementPercent?.toFixed(1)}% | ${r.metrics.readyMs.optimized.p90?.toFixed(1)} | ${r.required ? (r.passed ? "met" : "UNMET") : "—"} |`,
  )
  .join("\n");
const confirmation = ["baseline", "optimized"].map(
  (version) =>
    JSON.parse(readFileSync(root + `startup-confirmation-${version}.json`, "utf8")).results[0],
);
const confirmationReady = confirmation.map((result) => stats(result.samples.map((s) => s.readyMs)));
const confirmationLcp = confirmation.map((result) => stats(result.samples.map((s) => s.lcpMs)));
const confirmationNote = `## Separate homepage confirmation\n\nValidation briefly overlapped the first optimized homepage scenario. Before inspecting its outcome, a separate idle-host confirmation was scheduled for both versions: ten repetitions and one discarded warmup each, using the same readiness definition and mobile profile. Original samples above are retained. Confirmation readiness median: ${confirmationReady[0].median.toFixed(1)} → ${confirmationReady[1].median.toFixed(1)} ms (${(100 * (1 - confirmationReady[1].median / confirmationReady[0].median)).toFixed(2)}% faster). LCP median: ${confirmationLcp[0].median} → ${confirmationLcp[1].median} ms. This confirmation meets the homepage target; both populated dashboard targets remain unmet. Raw confirmation files preserve p90, maximum, transfer and error observations.\n\n`;
writeNewReport(
  prefix + ".md",
  `# Startup performance comparison\n\nTen measured repetitions and one discarded warmup per scenario. Mobile: 390 px, 150 ms latency, 1.6 Mbps download, 4× CPU slowdown. Desktop: 1440 px, unthrottled. Actual production homepage; separate production-mode full-app fixture build for dashboard. Synthetic session and RPC adapters do not establish real authentication or database performance. Versions ran sequentially on this computer; external font and host variability remain possible.\n\n| Scenario | Before median ms | After median ms | Improvement | After p90 ms | 20% target |\n|---|---:|---:|---:|---:|---|\n${table}\n\n${rows.filter((x) => x.required && !x.passed).length} required targets unmet. ${rows.filter((x) => x.regressions.length).length} scenarios have readiness/LCP median regressions above 10%; inspect machine-readable results and implementation notes. Raw failures, browser errors, network failures, transfer bytes, JavaScript transfers, maximums, LCP and layout shift are retained in the JSON files. Cached-return LCP/CLS are null because these are document paint metrics, not client-navigation measurements.\n\nHomepage readiness means the headline/primary scoring action is present and React has wired the menu's event handler; phone runs also exercise opening and closing the menu. Dashboard readiness uses the actual component's essential-data marker; summary completion is separate. Measurements observe DOM/event wiring, not an INP score. Cold runs create new browser contexts; warm reloads retain HTTP cache, and cached returns retain the app's query cache.\n\nSee [implementation and validation](startup-implementation.md), [baseline provenance](startup-source-baseline.json), [raw baseline](startup-baseline.json), [raw optimized](startup-optimized.json), and [full comparison](startup-comparison.json). No account identifiers, credentials or match content are included.\n`,
);
console.log(
  JSON.stringify(
    rows
      .filter((x) => x.required)
      .map((x) => ({
        scenario: `${x.kind} ${x.count ?? ""}`,
        improvement: x.metrics.readyMs.improvementPercent,
        passed: x.passed,
      })),
  ),
);
const reportPath = prefix + ".md";
appendFileSync(reportPath, "\n" + confirmationNote);
