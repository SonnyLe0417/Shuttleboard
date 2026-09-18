import assert from "node:assert/strict";
import test from "node:test";
import {
  canRetryAnalysis,
  keepRetryState,
  playbackButtonLabel,
  showsLastHitter,
} from "../src/lib/analysis-controls.ts";

test("playback label changes between play and pause", () => {
  assert.equal(playbackButtonLabel(true), "Pause");
  assert.equal(playbackButtonLabel(false), "Resume");
});

test("last hitter is available only for browser analysis", () => {
  assert.equal(showsLastHitter("browser"), true);
  assert.equal(showsLastHitter("tracknet"), false);
});

test("an analysis error enables retry", () => {
  assert.equal(canRetryAnalysis("TrackNet failed"), true);
  assert.equal(canRetryAnalysis(null), false);
});

test("retry keeps the uploaded video and court corners", () => {
  const state = { videoUrl: "blob:video", corners: [{ x: 1, y: 2 }] };
  assert.deepEqual(keepRetryState(state), state);
});
