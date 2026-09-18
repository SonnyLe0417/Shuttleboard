import assert from "node:assert/strict";
import test from "node:test";
import {
  canRetryWithSavedVideo,
  acquireAnalyzerLock,
  cancellationMessage,
  createFreshAnalyzerState,
  hasRequiredCorners,
  isCurrentAnalysisRun,
  resultsAreVisible,
  showsPlaybackControl,
  stateAfterUpload,
  togglePlayback,
} from "../src/lib/video-analyzer-flow.ts";

test("upload moves the analyzer to court calibration", () => {
  const state = stateAfterUpload("blob:match");
  assert.equal(state.phase, "calibrate");
  assert.equal(state.videoUrl, "blob:match");
});

test("four court corners are enough to start analysis", () => {
  assert.equal(hasRequiredCorners([1, 2, 3, 4]), true);
  assert.equal(hasRequiredCorners([1, 2, 3]), false);
});

test("pause and resume keep the current video time", () => {
  assert.deepEqual(togglePlayback(true, 12.5), { playing: false, currentTime: 12.5 });
  assert.deepEqual(togglePlayback(false, 12.5), { playing: true, currentTime: 12.5 });
});

test("retry is possible when the video and four corners are still saved", () => {
  assert.equal(canRetryWithSavedVideo("blob:match", [1, 2, 3, 4]), true);
  assert.equal(canRetryWithSavedVideo(null, [1, 2, 3, 4]), false);
});

test("start and retry locks allow only one action at a time", () => {
  assert.equal(acquireAnalyzerLock(false), true);
  assert.equal(acquireAnalyzerLock(true), false);
});

test("cancellation keeps the video and corners ready for another run", () => {
  const state = stateAfterUpload("blob:match");
  state.corners = [1, 2, 3, 4];
  assert.equal(state.videoUrl, "blob:match");
  assert.equal(state.corners.length, 4);
  assert.match(cancellationMessage(), /start again/);
});

test("a cancelled run cannot be treated as the current run", () => {
  assert.equal(isCurrentAnalysisRun(4, 4), true);
  assert.equal(isCurrentAnalysisRun(4, 5), false);
});

test("TrackNet processing does not show browser playback controls", () => {
  assert.equal(showsPlaybackControl("tracknet", "analyze"), false);
  assert.equal(showsPlaybackControl("browser", "analyze"), true);
});

test("completed analysis shows results and new video starts clean", () => {
  assert.equal(resultsAreVisible("done"), true);
  assert.deepEqual(createFreshAnalyzerState(), {
    phase: "upload",
    videoUrl: null,
    tracknetVideoUrl: null,
    tracknetPoints: [],
    corners: [],
    score: { p1: 0, p2: 0 },
    rallies: [],
    selectedRally: null,
    status: "",
    error: null,
  });
});
