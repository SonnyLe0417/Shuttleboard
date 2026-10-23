import { readFile, writeFile } from "node:fs/promises";

const data = JSON.parse(await readFile("docs/performance/dashboard-live-current.json", "utf8"));
const stale = await readFile("docs/performance/dashboard-live-stale.json", "utf8")
  .then(JSON.parse)
  .catch(() => ({ groups: [] }));
const groups = [...data.groups, ...stale.groups];
const median = (values) => {
  const sorted = values.filter((value) => typeof value === "number").toSorted((a, b) => a - b);
  return sorted.length
    ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2
    : null;
};
const p90 = (values) => {
  const sorted = values.filter((value) => typeof value === "number").toSorted((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(sorted.length * 0.9) - 1] : null;
};
const summaries = groups.map((group) => {
  const timings = group.test === "open-details" ? group.detailsMs : group.primaryMs;
  return {
    profile: group.profile,
    test: group.test,
    samples: group.samples,
    medianMs: median(timings),
    p90Ms: p90(timings),
    summaryMedianMs: median(group.summaryMs),
    minimumRequestCount: Math.min(...group.requestCounts),
    maximumRequestCount: Math.max(...group.requestCounts),
    medianDecodedApiBytes: median(group.decodedApiBytes),
    allVisible: group.allVisible,
    resourcesWithoutResponseTiming:
      group.resourcesWithoutResponseTiming?.reduce((a, b) => a + b, 0) ??
      (group.requestCounts.every((count) => count === 0) ? 0 : null),
    measurementWaitTimeouts: group.measurementWaitTimeouts?.filter(Boolean).length ?? 0,
    requestTiming: Object.fromEntries(
      ["core", "summary", "details", "onboarding"].map((kind) => {
        const values = (group[`${kind}RequestMs`] ?? []).flat();
        return [
          kind,
          {
            medianMs: median(values),
            p90Ms: p90(values),
            maximumMs: values.length ? Math.max(...values) : null,
          },
        ];
      }),
    ),
  };
});
const f = (value) => (value === null ? "—" : value.toFixed(1));
const rows = summaries
  .map(
    (row) =>
      `| ${row.profile} | ${row.test} | ${row.samples} | ${f(row.medianMs)} | ${f(row.p90Ms)} | ${row.minimumRequestCount}–${row.maximumRequestCount} | ${row.medianDecodedApiBytes} |`,
  )
  .join("\n");
const slowestSummary = Math.max(
  ...groups.flatMap((group) => (group.summaryRequestMs ?? []).flat()),
);
const waitTimeouts = summaries.reduce((total, row) => total + row.measurementWaitTimeouts, 0);
await writeFile(
  "docs/performance/dashboard-live-summary.json",
  JSON.stringify(
    { environment: data.environment, metric: data.metric, results: summaries },
    null,
    2,
  ) + "\n",
);
await writeFile(
  "docs/performance/dashboard-live-verification.md",
  `# Real-account dashboard observations

Signed-in Chrome on the local **development** server at port 5173. Phone viewport:
390 × 900; desktop: 1440 × 900. Both are unthrottled desktop-browser emulations.
These results are separate from the controlled production-built fixture comparison.

## Results

| Viewport | Scenario | Samples | Median ms | p90 ms | API resources | Decoded API bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
${rows}

Reloads retain the browser HTTP cache but recreate the page query cache. They are
**not cold browser-context loads**. Readiness means DOM availability of the primary
controls/profile/preferences/recent-match state, or progress details after clicking
its control; it is not paint, INP, or verified interaction latency. Summary timing
is recorded separately in the raw data. Cached and stale readiness permits existing
content while background refresh continues. API counts include onboarding and
expanded progress when applicable. Bytes are decoded bodies, not wire bytes.

Reload timing starts at document navigation. Return timing starts at **route-loader
entry**, after route guards, and can follow intent prefetch; it is not a complete
navigation-click-to-ready measurement. Stale request windows use explicit route
leave and query-start marks to include both completed prefetches and in-flight
refreshes. Negative request offsets mean a request began before the loader.

One warm-up is discarded per scenario. Medians average the middle two values;
p90 uses nearest rank. Phone and desktop runs happened sequentially on the same
computer, so their differences must not be interpreted as device-speed comparisons.

## Behavior and limitations

- All 20 fresh cached-return samples made zero dashboard requests.
- Expanded progress loaded with one deferred progress request per opening in all
  20 detail samples. The account's existing saved layout was used unchanged.
- The 390 px viewport had no document-level horizontal overflow.
- Three reload/detail samples included an extra core resource with no response
  timing or byte information. These are retained in resource counts; their outcome
  is unknown, and request deduplication is not claimed for those reloads.
- No account preferences, match records or scoring controls were changed.
- The diagnostic HMR cleanup was repaired after measurement: observers now watch
  only main content, excluding their own output, and dispose on hot reload. A
  synthetic fixture passed ten successive hot reloads with exactly one panel and
  functioning summary/detail readiness. Synthetic results are not account timings.

## Latency spike retained

The slowest observed summary response took **${f(slowestSummary)} ms**. There was
${waitTimeouts} measurement wait deadline exceedance; the same response was later
collected successfully, without reissuing the request. Cached primary content stayed
available. This outlier is retained in the raw data and maximum request statistic;
with ten samples, nearest-rank p90 alone can hide the single slowest response.
The cause is not isolated: network, authentication and database work are combined.

${stale.groups.length ? "Genuine stale-cache observations are included above; their raw wait durations and request timings are in dashboard-live-stale.json." : "Genuine stale-cache repetitions are still pending; no simulated cache aging is counted as a live-account result."}

The full production real-account matrix, fixed mobile network/CPU throttling,
initial JavaScript transfer measurement, and isolated authentication/database
spans remain unverified. Browser resource duration combines transport and server
work; onboarding request duration is not isolated authentication latency. No
matching pre-change real-account baseline exists, so no live-account percentage
speedup is claimed. Existing fixture acceptance targets remain unchanged.

Raw data: [current observations](dashboard-live-current.json),
[computed summary](dashboard-live-summary.json). Older frame-based observations
remain in dashboard-live-observations.json and are excluded from this comparison.
Reports contain timing/size/count metadata only, without credentials, account
identifiers, match content or account screenshots. Nothing was published.
`,
);
console.log(JSON.stringify(summaries, null, 2));
