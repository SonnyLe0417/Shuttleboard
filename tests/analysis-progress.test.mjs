import test from "node:test";
import assert from "node:assert/strict";
import { analysisProgressLabel, formatAnalysisEta } from "../src/lib/analysis-progress.ts";

test("labels upload, waiting, processing, complete, and failed states", () => {
  assert.equal(analysisProgressLabel("uploading"), "Uploading video");
  assert.equal(analysisProgressLabel("queued"), "Waiting to start");
  assert.equal(analysisProgressLabel("processing"), "Analyzing video");
  assert.equal(analysisProgressLabel("completed"), "Analysis complete");
  assert.equal(analysisProgressLabel("failed"), "Analysis failed");
});

test("formats analysis progress time simply", () => {
  assert.equal(formatAnalysisEta(8), "8s");
  assert.equal(formatAnalysisEta(68), "1m 8s");
  assert.equal(formatAnalysisEta(120), "2m");
  assert.equal(formatAnalysisEta(null), null);
});
