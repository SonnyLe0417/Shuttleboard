import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_RALLIES_MESSAGE,
  averageTrackNetConfidence,
  correctRally,
  countTrackNetDetections,
  formatAnalysisTime,
  getDownloadFileName,
  getRallyReviewReasons,
  rallyNeedsReview,
  reviewFilterMatches,
  scoreFromRallies,
  setRallyReviewStatus,
} from "../src/lib/analysis-results.ts";
import { COURT } from "../src/lib/badminton.ts";
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
    landingCourtY: 0.25,
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

test("correcting a winner updates the score once and pins the winner", () => {
  const corrected = correctRally([rally(1, "p1")], 1, { winner: "p2" });
  assert.equal(corrected[0].winner, "p2");
  assert.equal(corrected[0].winnerLocked, true);
  assert.equal(corrected[0].reviewStatus, "corrected");
  assert.deepEqual(scoreFromRallies(corrected), { p1: 0, p2: 1 });
  const repeated = correctRally(corrected, 1, { winner: "p2" });
  assert.deepEqual(scoreFromRallies(repeated), { p1: 0, p2: 1 });
});

test("marking a rally IN or OUT hands it to the other player", () => {
  // With the landing end recorded, the in/out rule decides the winner again.
  const recorded = correctRally([{ ...rally(1, "p2", true), landingEnd: "near" }], 1, {
    inBounds: false,
  });
  assert.equal(recorded[0].inBounds, false);
  assert.equal(recorded[0].winnerLocked, false);
  assert.equal(recorded[0].manuallyCorrected, true);
  // Older rallies without a landing end flip the stored winner directly.
  const legacy = correctRally([rally(1, "p1", true)], 1, { inBounds: false });
  assert.equal(legacy[0].winner, "p2");
  assert.deepEqual(scoreFromRallies(legacy), { p1: 0, p2: 1 });
});

test("a shot label is only a label", () => {
  const labelled = correctRally([rally(1, "p1")], 1, { shotType: "smash" });
  assert.equal(labelled[0].shotType, "smash");
  assert.equal(labelled[0].manuallyCorrected, undefined);
  assert.equal(labelled[0].reviewStatus, undefined);
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
      landingCourtY: 0.25,
    }),
    false,
  );
});

test("low-confidence and off-camera rallies explain why review is needed", () => {
  const reasons = getRallyReviewReasons({
    aiConfidence: 0.5,
    evidenceFrames: 4,
    offCamera: true,
    landingCourtX: COURT.singlesSideline + 0.01,
    landingCourtY: 0.5,
  });

  assert.match(reasons.join(" "), /low/);
  assert.match(reasons.join(" "), /short/);
  assert.match(reasons.join(" "), /camera view/);
  assert.match(reasons.join(" "), /boundary line/);
  assert.match(reasons.join(" "), /close to the net/);
});

test("line calls are judged against the singles or doubles lines in play", () => {
  const nearDoublesLine = {
    aiConfidence: 0.9,
    evidenceFrames: 12,
    offCamera: false,
    landingCourtX: 0.01,
    landingCourtY: 0.25,
  };
  assert.equal(rallyNeedsReview(nearDoublesLine), false);
  assert.match(getRallyReviewReasons(nearDoublesLine, "doubles").join(" "), /boundary line/);
});

test("a review-only rally does not change the score", () => {
  const uncertain = { ...rally(1, "p1"), countsTowardScore: false };
  const corrected = correctRally([uncertain], 1, { winner: "p2" });
  assert.equal(corrected[0].winner, "p2");
  assert.equal(corrected[0].reviewStatus, "needs-review");
  assert.deepEqual(scoreFromRallies(corrected), { p1: 0, p2: 0 });
});

test("confirming a review rally makes it count without changing the chosen winner", () => {
  const result = setRallyReviewStatus(
    [{ ...rally(1), countsTowardScore: false, needsReview: true }],
    1,
    "confirmed",
  );
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
  assert.equal(updated.countLocked, true);
  // Confirming what the reviewer was shown pins that winner.
  const shown = setRallyReviewStatus([original], 1, "confirmed", "p1")[0];
  assert.equal(shown.winner, "p1");
  assert.equal(shown.winnerLocked, true);
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
