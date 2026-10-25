import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeForeground } from "../benchmarks/startup/foreground-report.mjs";
function batch(build, scenario, id, overrides = {}) {
  return Array.from({ length: 11 }, (_, index) => ({
    protocol: 3,
    sessionElapsedMs: 100,
    navigationNumber: index + 1,
    sessionId: "session",
    batchId: id,
    build,
    scenario,
    sampleIndex: index,
    warmup: index === 0,
    scheduled: true,
    classification: "complete",
    backgrounded: false,
    cacheWindowValid: true,
    failures: 0,
    resourceErrors: 0,
    readyMs: 100 + index,
    summaryMs: 120 + index,
    viewport: { width: 1440, height: 900 },
    fingerprint: build,
    ...overrides,
  }));
}
test("foreground report separates protocols and batches and excludes warmups", () => {
  const samples = [
    ...batch("baseline", "reload", "old", { protocol: 2 }),
    ...batch("baseline", "reload", "partial").slice(0, 5),
    ...batch("baseline", "reload", "first"),
    ...batch("baseline", "reload", "faster", { readyMs: 1 }),
  ];
  const r = summarizeForeground({ samples });
  assert.equal(r.rows[0].batchId, "first");
  assert.equal(r.rows[0].metrics.readyMs.n, 10);
  assert.equal(r.rows[0].metrics.readyMs.median, 105.5);
  assert.equal(r.comparisonComplete, false);
  assert.equal(r.rawSampleCount, samples.length);
});
test("foreground report requires matching viewport, fresh cache and finite timings", () => {
  const samples = [
    ...batch("baseline", "reload", "a"),
    ...batch("optimized", "reload", "b", { viewport: { width: 390, height: 900 } }),
    ...batch("baseline", "cached-return", "c", { cacheWindowValid: false }),
    ...batch("optimized", "cached-return", "d", { readyMs: null }),
  ];
  const r = summarizeForeground({ samples });
  assert.equal(r.comparisonComplete, false);
  assert.equal(r.comparisons[0].comparable, false);
  assert.equal(r.rows[2].complete, true);
  assert.equal(r.rows[1].complete, false);
  assert.equal(r.rows[3].complete, false);
});
test("foreground report compares four complete batches and flags a regression", () => {
  const samples = [
    ...batch("baseline", "reload", "a"),
    ...batch("baseline", "cached-return", "b"),
    ...batch("optimized", "reload", "c", { readyMs: 200 }),
    ...batch("optimized", "cached-return", "d"),
  ];
  const r = summarizeForeground({ samples });
  assert.equal(r.comparisonComplete, true);
  assert.equal(r.comparisons[0].regressionAbove10Percent, true);
  assert.equal(r.comparisons[1].improvementPercent, 0);
});
test("failures and repeated successful indices cannot complete a batch", () => {
  const samples = batch("baseline", "reload", "a");
  samples[4].resourceErrors = 1;
  samples.push({ ...samples[3] });
  assert.equal(summarizeForeground({ samples }).rows[0].complete, false);
});
