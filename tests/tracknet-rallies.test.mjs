import assert from "node:assert/strict";
import test from "node:test";
import { buildTrackNetRallies } from "../src/lib/tracknet-rallies.ts";
import {
  isDirectTrackNetDetection,
  summarizeTrackNetFrames,
  trackNetVisualTrail,
} from "../src/lib/tracknet-evidence.ts";
import {
  rallyDiagnostics,
  scoreFromRallies,
  setRallyReviewStatus,
  sparseRallyWarning,
} from "../src/lib/analysis-results.ts";
import {
  createRallyEndState,
  updateRallyEndState,
  DIRECT_DETECTION_GAP_SECONDS,
  DIRECT_DETECTION_END_SECONDS,
} from "../src/lib/rally-end-detector.ts";
import {
  saveVideoAnalysisSession,
  loadVideoAnalysisSession,
} from "../src/lib/video-analysis-session.ts";

const H = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function point(time, x = 0.5, y = 0.6, extra = {}) {
  return {
    frame: Math.round(time * 30),
    time,
    x,
    y,
    visible: x !== null && y !== null,
    confidence: 0.9,
    detected: true,
    repaired: false,
    ...extra,
  };
}
const missing = (time) => point(time, null, null, { detected: false, confidence: 0 });
const repaired = (time, x = 0.5, y = 0.6) =>
  point(time, x, y, { detected: false, repaired: true, confidence: 0 });
const motion = [point(0, 0.2, 0.2), point(0.1, 0.3, 0.4), point(0.2, 0.5, 0.6)];
const rest = (start = 0.3, extra = {}) =>
  Array.from({ length: 11 }, (_, i) => point(start + i * 0.1, 0.5, 0.6, extra));

function feed(points, enabled = true) {
  let state = createRallyEndState();
  const events = [];
  const phases = [];
  for (const p of points) {
    const direct = isDirectTrackNetDetection(p);
    const result = updateRallyEndState(
      state,
      { ...p, visible: direct, x: direct ? p.x : null, y: direct ? p.y : null, cameraStable: true },
      { directDetectionGaps: enabled },
    );
    state = result.state;
    phases.push(state.phase);
    if (result.event) events.push(result.event);
  }
  return { state, events, phases };
}

test("direct evidence accepts old results and rejects repaired, missing, and invalid positions", () => {
  assert.equal(isDirectTrackNetDetection(point(0)), true);
  assert.equal(
    isDirectTrackNetDetection(point(0, 0.5, 0.5, { detected: undefined, repaired: undefined })),
    true,
  );
  for (const p of [
    repaired(0),
    missing(0),
    point(0, NaN),
    point(0, 0.5, 0.6, { detected: false }),
    point(0, 0.5, 0.6, { detected: true, repaired: true }),
  ]) {
    assert.equal(isDirectTrackNetDetection(p), false);
  }
});

test("a repaired-only moving path cannot produce rally events or points", () => {
  const points = [repaired(0, 0.2, 0.2), repaired(0.2), repaired(0.4), repaired(1.6), repaired(3)];
  assert.deepEqual(buildTrackNetRallies(points, H), []);
});

test("brief missing frames preserve the rally; pending gaps are cancelled when direct movement resumes", () => {
  const short = feed([...motion, missing(0.3), point(0.4, 0.7, 0.7)]);
  assert.equal(short.events.length, 0);
  assert.equal(short.state.phase, "active");
  const pending = feed([...motion, repaired(0.2 + DIRECT_DETECTION_GAP_SECONDS + 0.01)]);
  assert.equal(pending.state.phase, "possible-end");
  assert.equal(pending.events.length, 0);
  const resumed = feed([...motion, repaired(0.7), point(0.8, 0.8, 0.8)]);
  assert.equal(resumed.events.length, 0);
  assert.equal(resumed.state.phase, "active");
});

test("a disappearing shuttle without a visible stop does not propose a point", () => {
  const points = [
    ...motion,
    point(0.3),
    repaired(0.8, 0.9, 0.9),
    missing(1.31),
    missing(2),
    missing(3),
  ];
  const rallies = buildTrackNetRallies(points, H);
  assert.equal(rallies.length, 0);
  assert.deepEqual(scoreFromRallies(rallies), { p1: 0, p2: 0 });
});

test("repaired movement during a long gap cannot create a point", () => {
  const rallies = buildTrackNetRallies(
    [
      ...motion,
      repaired(0.6, 0.7, 0.8),
      repaired(0.2 + DIRECT_DETECTION_END_SECONDS + 0.01, 0.9, 0.9),
    ],
    H,
  );
  assert.deepEqual(rallies, []);
});

test("sparse long gaps do not propose points on either side of the gap", () => {
  const rallies = buildTrackNetRallies(
    [...motion, point(1.4, 0.2, 0.2), point(1.5, 0.3, 0.4), point(1.6, 0.5, 0.6), missing(2.7)],
    H,
  );
  assert.deepEqual(rallies, []);
});

test("missing intervals cannot count as a visibly stationary landing", () => {
  const result = feed([...motion, point(0.3), missing(0.7), point(0.8), point(1.0)]);
  assert.equal(result.events.length, 0);
  assert.equal(result.state.candidateSince, 0.8);
});

test("continuous direct landing evidence can still auto-score", () => {
  const points = [...motion];
  for (let i = 3; i <= 15; i++) points.push(point(i / 10));
  const rallies = buildTrackNetRallies(points, H);
  assert.equal(rallies.length, 1);
  assert.equal(rallies[0].countsTowardScore, true);
  assert.deepEqual(scoreFromRallies(rallies), { p1: 0, p2: 1 });
});

test("a short pause does not count as a landing", () => {
  assert.deepEqual(buildTrackNetRallies([...motion, ...rest().slice(0, 7)], H), []);
});

test("one shaky sighting in a long rest does not split the point", () => {
  const sightings = rest();
  sightings[5] = point(0.8, 0.51, 0.6);
  const rallies = buildTrackNetRallies([...motion, ...sightings], H);
  assert.equal(rallies.length, 1);
  assert.equal(rallies[0].countsTowardScore, true);
});

test("missing and AI-filled frames cannot join two short rests into one", () => {
  const before = rest(0.3).slice(0, 6);
  const after = rest(1.0).slice(0, 6);
  assert.deepEqual(buildTrackNetRallies([...motion, ...before, missing(0.9), ...after], H), []);
  assert.deepEqual(buildTrackNetRallies([...motion, ...before, repaired(0.9), ...after], H), []);
});

test("two direct sightings far apart do not prove the shuttle stayed still between them", () => {
  assert.deepEqual(buildTrackNetRallies([point(0), point(1, 0.5, 0.6)], H), []);
});

test("a shuttle held before serving does not become a point", () => {
  const held = rest(0.3).map((p) => ({ ...p, y: 0.3 }));
  assert.deepEqual(buildTrackNetRallies(held, H), []);
});

test("a directly seen downward approach permits a stop in the serve-ready area", () => {
  const approach = [point(0, 0.5, 0.2), point(0.1, 0.5, 0.26), point(0.2, 0.5, 0.3)];
  const landing = rest(0.3).map((p) => ({ ...p, y: 0.3 }));
  assert.equal(buildTrackNetRallies([...approach, ...landing], H).length, 1);
});

test("a stop near the court boundary needs review and cannot change the score", () => {
  const boundary = rest(0.3).map((p) => ({ ...p, x: 0.02 }));
  const rallies = buildTrackNetRallies([...motion, ...boundary], H);
  assert.equal(rallies.length, 1);
  assert.equal(rallies[0].needsReview, true);
  assert.equal(rallies[0].countsTowardScore, false);
  assert.deepEqual(scoreFromRallies(rallies), { p1: 0, p2: 0 });
});

test("a stop by the camera edge or outside the court cannot score automatically", () => {
  const cases = [
    { x: 0.03, homography: H },
    { x: 0.8, homography: [1.5, 0, 0, 0, 1, 0, 0, 0, 1] },
  ];
  for (const { x, homography } of cases) {
    const edge = rest(0.3).map((p) => ({ ...p, x }));
    const rallies = buildTrackNetRallies([...motion, ...edge], homography);
    assert.equal(rallies.length, 1);
    assert.equal(rallies[0].needsReview, true);
    assert.deepEqual(scoreFromRallies(rallies), { p1: 0, p2: 0 });
  }
});

test("a repeated sighting of the same stop cannot propose a second point", () => {
  const first = rest();
  const second = rest(1.4).map((p) => ({ ...p, x: 0.55 }));
  const rallies = buildTrackNetRallies([...motion, ...first, ...second], H);
  assert.equal(rallies.length, 1);
});

test("invalid court calibration cannot produce a score", () => {
  assert.deepEqual(buildTrackNetRallies([...motion, ...rest()], Array(9).fill(0)), []);
});

test("legacy coordinates from the current engine can prove a visible stop", () => {
  const old = [...motion, ...rest()].map(({ detected, repaired, ...p }) => p);
  const rallies = buildTrackNetRallies(old, H);
  assert.equal(rallies.length, 1);
  assert.equal(rallies[0].t, 1.3);
  assert.equal(rallies[0].offCamera, false);
  assert.equal(rallies[0].evidenceFrames, 12);
  assert.deepEqual(scoreFromRallies(rallies), { p1: 0, p2: 1 });
});

test("visual trail retains repaired positions and rally processing does not mutate output", () => {
  const points = [...motion, repaired(0.7), missing(1.3)];
  const snapshot = structuredClone(points);
  buildTrackNetRallies(points, H);
  const trail = trackNetVisualTrail(points, 1.3);
  assert.equal(trail.length, 4);
  assert.equal(trail.at(-1).repaired, true);
  assert.equal(trail.at(-1).confidence, 0);
  assert.deepEqual(points, snapshot);
});

test("frame diagnostics separate direct, repaired and missing rows including legacy results", () => {
  const points = [
    ...motion,
    repaired(0.7),
    missing(1.3),
    point(2, 0.5, 0.5, { detected: undefined, repaired: undefined }),
  ];
  assert.deepEqual(summarizeTrackNetFrames(points), {
    totalFrames: 6,
    directFrames: 4,
    repairedFrames: 1,
    missingFrames: 1,
    durationSeconds: 2,
  });
});

test("confirm, repeated confirm, correction, undo and reconfirm keep score and review totals consistent", () => {
  let rallies = buildTrackNetRallies([...motion, ...rest(0.3, { confidence: 0.6 })], H);
  assert.deepEqual(rallyDiagnostics(rallies), {
    possibleEndings: 1,
    confirmedEndings: 0,
    needsReview: 1,
  });
  rallies = setRallyReviewStatus(rallies, 1, "confirmed");
  rallies = setRallyReviewStatus(rallies, 1, "confirmed");
  assert.deepEqual(scoreFromRallies(rallies), { p1: 0, p2: 1 });
  assert.equal(rallies[0].needsReview, false);
  rallies = [{ ...rallies[0], winner: "p1" }];
  assert.deepEqual(scoreFromRallies(rallies), { p1: 1, p2: 0 });
  rallies = setRallyReviewStatus(rallies, 1, "needs-review");
  assert.deepEqual(scoreFromRallies(rallies), { p1: 0, p2: 0 });
  rallies = setRallyReviewStatus(rallies, 1, "confirmed");
  assert.deepEqual(rallyDiagnostics(rallies), {
    possibleEndings: 1,
    confirmedEndings: 1,
    needsReview: 0,
  });
});

test("confirmed review points and diagnostics survive saving and restoring the matching job", () => {
  const points = [...motion, ...rest(0.3, { confidence: 0.6 })];
  const rallies = setRallyReviewStatus(buildTrackNetRallies(points, H), 1, "confirmed");
  const values = new Map();
  const storage = { setItem: (k, v) => values.set(k, v), getItem: (k) => values.get(k) ?? null };
  saveVideoAnalysisSession(storage, {
    videoKey: "test",
    rallies,
    score: scoreFromRallies(rallies),
    analysisMode: "tracknet",
    processedVideoUrl: "/video.mp4",
    tracknetJobId: "job-1",
    tracknetFrameDiagnostics: summarizeTrackNetFrames(points),
  });
  const restored = loadVideoAnalysisSession(storage, "test");
  assert.deepEqual(restored.score, { p1: 0, p2: 1 });
  assert.deepEqual(scoreFromRallies(restored.rallies), restored.score);
  assert.equal(restored.tracknetJobId, "job-1");
  assert.equal(restored.tracknetFrameDiagnostics.directFrames, 14);
  assert.equal(loadVideoAnalysisSession(storage, "another-video"), null);
});

test("sparse-rally notice describes missing evidence rather than asserting match point totals", () => {
  const long = {
    totalFrames: 1800,
    directFrames: 600,
    repairedFrames: 200,
    missingFrames: 1000,
    durationSeconds: 60,
  };
  assert.match(sparseRallyWarning(long, []), /not the match's full point count/);
  assert.equal(sparseRallyWarning({ ...long, durationSeconds: 4 }, []), null);
  assert.equal(sparseRallyWarning({ ...long, directFrames: 0 }, []), null);
  assert.equal(sparseRallyWarning(long, Array(6).fill({})), null);
});
