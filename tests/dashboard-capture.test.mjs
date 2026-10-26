import test from "node:test";
import assert from "node:assert/strict";
import { captureSample, canCapture } from "../src/lib/dashboard-capture.ts";
const row = (sample, extra = {}) => ({
  sample,
  scenario: "document-load",
  outcome: "success",
  queryOutcome: "success",
  durationMs: 200,
  slow: null,
  visibilityChanged: false,
  serverTiming: [],
  ...extra,
});
test("capture exports fixed fields and allowlisted timing spans only", () => {
  const result = captureSample(
    row(12, {
      token: "secret",
      serverTiming: [
        { name: "dash_total", durationMs: 25, description: "private" },
        { name: "private", durationMs: 9 },
      ],
    }),
  );
  assert.deepEqual(result.serverTiming, [{ name: "dash_total", durationMs: 25 }]);
  assert.ok(!JSON.stringify(result).includes("secret"));
  assert.ok(!JSON.stringify(result).includes("private"));
});
test("missing, failed and interrupted timings remain distinct from zero", () => {
  assert.equal(
    captureSample(row(1, { outcome: "interrupted", durationMs: null })).durationMs,
    null,
  );
  assert.equal(captureSample(row(1, { outcome: "failure", durationMs: NaN })).slow, null);
  assert.equal(captureSample(row(1, { durationMs: 0 })).durationMs, 0);
  assert.equal(captureSample(row(1, { durationMs: 2001 })).slow, true);
});
test("capture stops at the time and request bounds", () => {
  assert.equal(canCapture(59, 0, 1799999), true);
  assert.equal(canCapture(60, 0, 100), false);
  assert.equal(canCapture(1, 0, 1800000), false);
});
