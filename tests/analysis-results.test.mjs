import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_RALLIES_MESSAGE,
  applyRallyCorrection,
  averageTrackNetConfidence,
  countTrackNetDetections,
  formatAnalysisTime,
  getDownloadFileName,
  getRallyReviewReasons,
  rallyNeedsReview,
  reviewFilterMatches,
  setRallyReviewStatus,
} from "../src/lib/analysis-results.ts";
import {
  VIDEO_ANALYSIS_SESSION_KEY,
  clearVideoAnalysisSession,
  createVideoSessionKey,
  loadVideoAnalysisSession,
  saveVideoAnalysisSession,
} from "../src/lib/video-analysis-session.ts";

function rally(id, winner = "p1", inBounds = true) {
  return {
    id,
    t: id * 12.5,
    landingImgX: 10,
    landingImgY: 20,
    landingCourtX: 0.5,
    landingCourtY: 0.5,
    inBounds,
    winner,
    aiConfidence: 0.9,
    aiNote: "Detected landing",
  };
}

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("completed analysis exposes the final score and rally count", () => {
  const rallies = [rally(1, "p1"), rally(2, "p2"), rally(3, "p1")];
  const score = rallies.reduce(
    (result, item) => ({ ...result, [item.winner]: result[item.winner] + 1 }),
    { p1: 0, p2: 0 },
  );

  assert.deepEqual(score, { p1: 2, p2: 1 });
  assert.equal(rallies.length, 3);
});

test("the processed video download uses the TrackNet filename", () => {
  assert.equal(getDownloadFileName(), "tracknet_predict.mp4");
});

test("no rallies has a clear empty message", () => {
  assert.equal([].length, 0);
  assert.match(EMPTY_RALLIES_MESSAGE, /No rallies scored yet/);
});

test("correcting a winner updates the score once", () => {
  const result = applyRallyCorrection([rally(1, "p1")], { p1: 1, p2: 0 }, 1, {
    winner: "p2",
  });

  assert.equal(result.rallies[0].winner, "p2");
  assert.deepEqual(result.score, { p1: 0, p2: 1 });

  const repeated = applyRallyCorrection(result.rallies, result.score, 1, { winner: "p2" });
  assert.deepEqual(repeated.score, { p1: 0, p2: 1 });
});

test("marking a rally IN or OUT updates its display value", () => {
  const result = applyRallyCorrection([rally(1, "p1", true)], { p1: 1, p2: 0 }, 1, {
    inBounds: false,
  });

  assert.equal(result.rallies[0].inBounds, false);
  assert.equal(result.rallies[0].manuallyCorrected, true);
});

test("selecting a key moment uses the rally video time", () => {
  assert.equal(formatAnalysisTime(rally(4).t), "0:50");
});

test("TrackNet detection count and confidence use visible frames", () => {
  const points = [
    { frame: 1, time: 0, x: 1, y: 1, confidence: 0.8, visible: true },
    { frame: 2, time: 0.03, x: null, y: null, confidence: 0.2, visible: false },
    { frame: 3, time: 0.06, x: 2, y: 2, confidence: 1, visible: true },
  ];

  assert.equal(countTrackNetDetections(points), 2);
  assert.equal(averageTrackNetConfidence(points), 90);
});

test("high-confidence landing evidence does not need review", () => {
  assert.equal(
    rallyNeedsReview({
      aiConfidence: 0.9,
      evidenceFrames: 12,
      offCamera: false,
      landingCourtX: 0.5,
      landingCourtY: 0.5,
    }),
    false,
  );
});

test("low-confidence and off-camera rallies explain why review is needed", () => {
  const reasons = getRallyReviewReasons({
    aiConfidence: 0.5,
    evidenceFrames: 4,
    offCamera: true,
    landingCourtX: 0.98,
    landingCourtY: 0.5,
  });

  assert.match(reasons.join(" "), /low/);
  assert.match(reasons.join(" "), /short/);
  assert.match(reasons.join(" "), /camera view/);
  assert.match(reasons.join(" "), /boundary/);
});

test("a review-only rally does not change the score", () => {
  const uncertain = { ...rally(1, "p1"), countsTowardScore: false };
  const result = applyRallyCorrection([uncertain], { p1: 0, p2: 0 }, 1, { winner: "p2" });
  assert.equal(result.rallies[0].winner, "p2");
  assert.deepEqual(result.score, { p1: 0, p2: 0 });
});

test("confirming a review rally makes it count without changing the chosen winner", () => {
  const result = setRallyReviewStatus([{ ...rally(1), countsTowardScore: false, needsReview: true }], 1, "confirmed");
  assert.equal(result[0].reviewStatus, "confirmed");
  assert.equal(result[0].winner, "p1");
  assert.equal(result[0].countsTowardScore, true);
  assert.equal(result[0].needsReview, false);
});

test("review filters select the correct rallies", () => {
  const needsReview = { ...rally(1), needsReview: true, reviewStatus: "needs-review" };
  const confirmed = { ...rally(2), reviewStatus: "confirmed" };
  const corrected = { ...rally(3), reviewStatus: "corrected" };

  assert.equal(reviewFilterMatches(needsReview, "needs-review"), true);
  assert.equal(reviewFilterMatches(confirmed, "needs-review"), false);
  assert.equal(reviewFilterMatches(corrected, "corrected"), true);
  assert.equal(reviewFilterMatches(needsReview, "all"), true);
});

test("confirming a rally preserves winner and court decision", () => {
  const original = rally(1, "p2");
  const updated = setRallyReviewStatus([original], 1, "confirmed")[0];
  assert.equal(updated.winner, original.winner);
  assert.equal(updated.inBounds, original.inBounds);
});

test("saves and restores review statuses and corrections", () => {
  const store = storage();
  const videoKey = createVideoSessionKey({ name: "match.mp4", size: 42, lastModified: 7 });
  const needsReview = { ...rally(1), needsReview: true, reviewStatus: "needs-review" };
  const confirmed = { ...rally(2, "p1"), reviewStatus: "confirmed" };
  const corrected = {
    ...rally(3, "p2", false),
    reviewStatus: "corrected",
    manuallyCorrected: true,
    shotType: "smash",
  };

  saveVideoAnalysisSession(store, {
    videoKey,
    rallies: [needsReview, confirmed, corrected],
    score: { p1: 0, p2: 1 },
    processedVideoUrl: "/processed.mp4",
    analysisMode: "tracknet",
  });

  const restored = loadVideoAnalysisSession(store, videoKey);
  assert.equal(restored.rallies[0].reviewStatus, "needs-review");
  assert.equal(restored.rallies[1].reviewStatus, "confirmed");
  assert.equal(restored.rallies[2].reviewStatus, "corrected");
  assert.equal(restored.rallies[2].winner, "p2");
  assert.equal(restored.rallies[2].inBounds, false);
  assert.equal(restored.rallies[2].shotType, "smash");
  assert.deepEqual(restored.score, { p1: 0, p2: 1 });
});

test("does not restore saved data for a different video", () => {
  const store = storage();
  const savedKey = createVideoSessionKey({ name: "first.mp4", size: 1, lastModified: 2 });
  const otherKey = createVideoSessionKey({ name: "second.mp4", size: 1, lastModified: 2 });
  saveVideoAnalysisSession(store, {
    videoKey: savedKey,
    rallies: [rally(1)],
    score: { p1: 1, p2: 0 },
    processedVideoUrl: null,
    analysisMode: "browser",
  });

  assert.equal(loadVideoAnalysisSession(store, otherKey), null);
});

test("clearing a new video removes the saved review session", () => {
  const store = storage();
  store.setItem(VIDEO_ANALYSIS_SESSION_KEY, "saved review data");
  clearVideoAnalysisSession(store);
  assert.equal(store.getItem(VIDEO_ANALYSIS_SESSION_KEY), null);
});
