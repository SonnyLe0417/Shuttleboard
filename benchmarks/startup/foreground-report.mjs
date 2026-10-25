import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const metrics = [
  "readyMs",
  "summaryMs",
  "requests",
  "exposedTransferBytes",
  "javascriptTransferBytes",
  "hookSetupMs",
];
function stats(values) {
  const a = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    n: a.length,
    median: a.length ? (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2 : null,
    p90: a.length ? a[Math.ceil(0.9 * a.length) - 1] : null,
    max: a.at(-1) ?? null,
  };
}
export function summarizeForeground(data) {
  const source = data.samples ?? [];
  const sessionId = source.find((s) => s.protocol === 3 && s.scheduled && s.sessionId)?.sessionId;
  const samples = source.filter((s) => s.protocol === 3 && s.sessionId === sessionId);
  const groups = [];
  for (const s of samples) {
    if (!s.batchId) continue;
    let group = groups.find(
      (g) => g.id === s.batchId && g.build === s.build && g.scenario === s.scenario,
    );
    if (!group) {
      group = { id: s.batchId, build: s.build, scenario: s.scenario, samples: [] };
      groups.push(group);
    }
    group.samples.push(s);
  }
  const successful = (s) =>
    s.scheduled &&
    s.classification === "complete" &&
    !s.backgrounded &&
    s.cacheWindowValid === true &&
    !s.failures &&
    !s.resourceErrors &&
    Number.isFinite(s.sessionElapsedMs) &&
    s.sessionElapsedMs >= 0 &&
    s.sessionElapsedMs < 1200000 &&
    Number.isInteger(s.navigationNumber) &&
    s.navigationNumber >= 1 &&
    s.navigationNumber <= 80 &&
    typeof s.fingerprint === "string" &&
    s.fingerprint.length > 0 &&
    Number.isFinite(s.viewport?.width) &&
    s.viewport.width > 0 &&
    Number.isFinite(s.viewport?.height) &&
    s.viewport.height > 0 &&
    Number.isFinite(s.readyMs) &&
    Number.isFinite(s.summaryMs);
  const viewport = (s) => `${s.viewport?.width}x${s.viewport?.height}`;
  for (const g of groups) {
    g.valid = g.samples.filter(successful);
    const indices = g.valid.map((s) => s.sampleIndex);
    g.complete =
      Array.from({ length: 11 }, (_, i) => i).every(
        (i) => indices.filter((n) => n === i).length === 1,
      ) &&
      g.valid.length === 11 &&
      g.valid.filter((s) => s.warmup && s.sampleIndex === 0).length === 1 &&
      g.valid.filter((s) => !s.warmup && s.sampleIndex > 0).length === 10 &&
      new Set(g.valid.map(viewport)).size === 1 &&
      new Set(g.valid.map((s) => s.fingerprint)).size === 1;
  }
  const rows = [];
  for (const build of ["baseline", "optimized"])
    for (const scenario of ["reload", "cached-return"]) {
      const candidates = groups.filter((g) => g.build === build && g.scenario === scenario);
      const selected = candidates.find((g) => g.complete); // First complete batch, never best timing.
      const measured = selected?.valid.filter((s) => !s.warmup) ?? [];
      rows.push({
        build,
        scenario,
        batchId: selected?.id ?? null,
        complete: !!selected,
        viewport: measured[0] ? viewport(measured[0]) : null,
        fingerprint: measured[0]?.fingerprint ?? null,
        recorded: samples.filter((s) => s.build === build && s.scenario === scenario).length,
        metrics: Object.fromEntries(metrics.map((k) => [k, stats(measured.map((s) => s[k]))])),
      });
    }
  const comparisons = ["reload", "cached-return"].map((scenario) => {
    const before = rows.find((r) => r.build === "baseline" && r.scenario === scenario),
      after = rows.find((r) => r.build === "optimized" && r.scenario === scenario);
    const comparable =
      before.complete &&
      after.complete &&
      before.viewport === after.viewport &&
      before.fingerprint !== after.fingerprint;
    const improvementPercent =
      comparable && before.metrics.readyMs.median > 0
        ? 100 * (1 - after.metrics.readyMs.median / before.metrics.readyMs.median)
        : null;
    return {
      scenario,
      comparable,
      improvementPercent,
      regressionAbove10Percent: comparable && improvementPercent < -10,
    };
  });
  const classes = Object.fromEntries(
    [...new Set(samples.map((s) => s.classification))].map((c) => [
      c,
      samples.filter((s) => s.classification === c).length,
    ]),
  );
  const complete =
    rows.every((r) => r.complete) &&
    new Set(rows.map((r) => r.viewport)).size === 1 &&
    ["baseline", "optimized"].every(
      (build) =>
        new Set(rows.filter((r) => r.build === build).map((r) => r.fingerprint)).size === 1,
    ) &&
    comparisons.every((c) => c.comparable);
  return {
    schema: 1,
    protocol: 3,
    sessionId: sessionId ?? null,
    comparisonComplete: complete,
    rows,
    comparisons,
    classifications: classes,
    batches: groups.map((g) => ({
      id: g.id,
      build: g.build,
      scenario: g.scenario,
      complete: g.complete,
      recorded: g.samples.length,
    })),
    rawSampleCount: source.length,
    protocolSessionSampleCount: samples.length,
    unselectedSampleCount: source.length - rows.reduce((n, r) => n + r.metrics.readyMs.n, 0),
  };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const input = process.argv[2] ?? "docs/performance/startup-account-foreground-measurements.json";
  const prefix = process.argv[3] ?? "docs/performance/startup-account-foreground";
  const outputs = [prefix + "-summary.json", prefix + "-report.md"];
  if (outputs.some(existsSync))
    throw Error("Report already exists; choose a new output prefix to preserve it");
  const summary = summarizeForeground(JSON.parse(readFileSync(input, "utf8")));
  writeFileSync(outputs[0], JSON.stringify(summary, null, 2) + "\n");
  writeFileSync(
    outputs[1],
    `# Foreground signed-in comparison\n\nProtocol 3, first recorded session; first complete batch per build/scenario. Warmup index 0 is excluded. Old protocols, manual checks, partial batches, missing timings, known errors, hidden/resized samples and expired cache windows are not eligible. Every raw record remains in the separate input export.\n\nComparison complete: **${summary.comparisonComplete}**.\n\n| Build | Scenario | Recorded | Selected n | Median ms | p90 ms | Maximum ms |\n|---|---|---:|---:|---:|---:|---:|\n${summary.rows.map((r) => `| ${r.build} | ${r.scenario} | ${r.recorded} | ${r.metrics.readyMs.n} | ${r.metrics.readyMs.median?.toFixed(1) ?? "missing"} | ${r.metrics.readyMs.p90?.toFixed(1) ?? "missing"} | ${r.metrics.readyMs.max?.toFixed(1) ?? "missing"} |`).join("\n")}\n\n${summary.comparisons.map((c) => `${c.scenario}: ${c.comparable ? `${c.improvementPercent.toFixed(1)}% readiness improvement${c.regressionAbove10Percent ? "; investigate regression above 10%" : ""}` : "not comparable; missing complete matching batches"}.`).join("\n\n")}\n\nSummary completion, resource counts, exposed bytes, maxima and classification counts are in the summary JSON. Sizes are partial Resource Timing observations: zero may mean cached or unavailable. Counts cover observed completed resources, not every initiated request. No precise auth/database spans or LCP are claimed. Setup duration excludes ongoing polling and persistence overhead. These unthrottled account observations must remain separate from fixture benchmarks. Investigate cache behavior and observed resource durations before proposing a targeted change; do not infer database latency from DOM timing.\n`,
  );
  console.log(
    JSON.stringify({
      comparisonComplete: summary.comparisonComplete,
      comparisons: summary.comparisons,
    }),
  );
}
