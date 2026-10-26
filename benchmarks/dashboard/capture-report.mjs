import { readFileSync } from "node:fs";
import { assertNewOutputs, writeNewReport } from "../startup/output.mjs";
const root = "docs/performance/";
const prefix = process.argv[3] ?? root + "dashboard-summary-capture";
assertNewOutputs([prefix + "-summary.json", prefix + ".md"]);
const input = JSON.parse(
  readFileSync(process.argv[2] ?? root + "dashboard-summary-capture.json", "utf8"),
);
const excluded = new Set(input.excludedSamples.map((row) => row.sample));
const samples =
  input.samples ??
  input.rows.map((row) => ({
    ...input.common,
    sample: row[0],
    scenario: input.scenarioCodes[row[1]],
    durationMs: row[2],
    visibilityChanged: row[3],
    slow: row[2] === null ? null : row[2] > 2000,
    serverTiming: input.rowColumns
      .slice(4)
      .flatMap((name, index) =>
        row[index + 4] === null ? [] : [{ name: `dash_${name}`, durationMs: row[index + 4] }],
      ),
  }));
const measured = samples.filter((row) => !excluded.has(row.sample));
const stats = (values) => {
  const sorted = values
    .filter((value) => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);
  const n = sorted.length;
  return {
    count: n,
    medianMs: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null,
    p90Ms: n ? sorted[Math.ceil(n * 0.9) - 1] : null,
    maxMs: n ? sorted[n - 1] : null,
  };
};
const groups = Object.fromEntries(
  ["document-load", "stale-return"].map((scenario) => {
    const rows = measured.filter((row) => row.scenario === scenario);
    return [
      scenario,
      {
        ...stats(rows.map((row) => row.durationMs)),
        failures: rows.filter((row) => row.outcome === "failure" || row.queryOutcome === "failure")
          .length,
        unknown: rows.filter((row) => row.outcome === "unknown").length,
        interrupted: rows.filter((row) => row.outcome === "interrupted").length,
        visibilityFlagged: rows.filter((row) => row.visibilityChanged).length,
        missingSpans: rows.filter((row) => !row.serverTiming.length).length,
      },
    ];
  }),
);
const slow = measured.filter((row) => row.slow);
const summary = {
  groups,
  slowRequests: slow,
  serverSpans: Object.fromEntries(
    [
      "auth_setup",
      "module_load",
      "matches",
      "quests",
      "progress",
      "insights",
      "completed",
      "aggregate",
      "total",
    ].map((name) => [
      name,
      stats(
        measured.map(
          (row) => row.serverTiming.find((span) => span.name === `dash_${name}`)?.durationMs,
        ),
      ),
    ]),
  ),
};
writeNewReport(prefix + "-summary.json", JSON.stringify(summary, null, 2) + "\n");
const table = Object.entries(groups)
  .map(
    ([name, row]) =>
      `| ${name} | ${row.count} | ${row.medianMs?.toFixed(1) ?? "unknown"} | ${row.p90Ms?.toFixed(1) ?? "unknown"} | ${row.maxMs?.toFixed(1) ?? "unknown"} | ${row.failures} | ${row.visibilityFlagged} |`,
  )
  .join("\n");
writeNewReport(
  prefix + ".md",
  `# Bounded signed-in summary capture\n\nLocal development, unthrottled desktop Chrome. No production speedup is claimed.\n\n| Scenario | Timed requests | Median ms | p90 ms | Maximum ms | Failures | Visibility flagged |\n|---|---:|---:|---:|---:|---:|---:|\n${table}\n\n${slow.length} measured requests exceeded the 2,000 ms diagnostic threshold. Missing timing is preserved as null; failed, unknown and interrupted counts appear separately in the machine-readable summary. Parallel server spans overlap and must not be summed. Supabase spans combine transport, gateway and database work; they are not SQL execution times.\n\nThe historical 28.6-second request was uninstrumented. This session cannot retrospectively identify its cause. ${input.logAvailability}\n\nProtocol: ${input.protocol}\n\nCollection notes: ${input.notes.join(" ")}\n\nRaw session: [dashboard-summary-capture.json](dashboard-summary-capture.json). Computed results: [dashboard-summary-capture-summary.json](dashboard-summary-capture-summary.json). Nothing was deployed, pushed, or changed in the account.\n`,
);
console.log(JSON.stringify(summary));
