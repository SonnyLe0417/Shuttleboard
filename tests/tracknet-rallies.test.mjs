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
import { COURT } from "../src/lib/badminton.ts";
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
// A shot in flight: several fast sightings, unlike a pickup or a flick.
const motion = [
  point(0, 0.2, 0.2),
  point(0.05, 0.3, 0.35),
  point(0.1, 0.4, 0.45),
  point(0.15, 0.45, 0.55),
  point(0.2, 0.5, 0.6),
];
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
  const approach = [0, 0.05, 0.1, 0.15, 0.2].map((t) => point(t, 0.5, 0.1 + t));
  const landing = rest(0.3).map((p) => ({ ...p, y: 0.3 }));
  assert.equal(buildTrackNetRallies([...approach, ...landing], H).length, 1);
});

test("a stop on a boundary line needs review and cannot change the score", () => {
  // 6 cm inside the singles sideline.
  const boundary = rest(0.3).map((p) => ({ ...p, x: COURT.singlesSideline + 0.01 }));
  const rallies = buildTrackNetRallies([...motion, ...boundary], H);
  assert.equal(rallies.length, 1);
  assert.equal(rallies[0].needsReview, true);
  assert.equal(rallies[0].countsTowardScore, false);
  assert.equal(rallies[0].landingAmbiguous, true);
  assert.deepEqual(scoreFromRallies(rallies), { p1: 0, p2: 0 });
});

test("a clear out scores for the player at the end it landed on", () => {
  // In the doubles alley at the near end: out in singles, so the near player wins.
  const alley = rest(0.3).map((p) => ({ ...p, x: 0.03, y: 0.8 }));
  const [singles] = buildTrackNetRallies([...motion, ...alley], H);
  assert.equal(singles.inBounds, false);
  assert.equal(singles.landingEnd, "near");
  assert.equal(singles.countsTowardScore, true);
  assert.equal(singles.winner, "p1");
  const [doubles] = buildTrackNetRallies([...motion, ...alley], H, { mode: "doubles" });
  assert.equal(doubles.inBounds, true);
  assert.equal(doubles.winner, "p2");
});

test("a stop by the camera edge or outside the court cannot score automatically", () => {
  const cases = [
    { x: 0.005, homography: H },
    // More than 2 m outside the court.
    { x: 0.8, homography: [2, 0, 0, 0, 1, 0, 0, 0, 1] },
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
  // The rally ends when the shuttle lands, not when it is picked up.
  assert.equal(rallies[0].t, 0.2);
  assert.equal(rallies[0].offCamera, false);
  assert.equal(rallies[0].evidenceFrames, 12);
  assert.deepEqual(scoreFromRallies(rallies), { p1: 0, p2: 1 });
});

test("visual trail retains repaired positions and rally processing does not mutate output", () => {
  const points = [...motion, repaired(0.7), missing(1.3)];
  const snapshot = structuredClone(points);
  buildTrackNetRallies(points, H);
  const trail = trackNetVisualTrail(points, 1.3);
  assert.equal(trail.length, 6);
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
    totalFrames: 8,
    directFrames: 6,
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
  assert.equal(restored.tracknetFrameDiagnostics.directFrames, 16);
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

const at30 = (from, to, place) => {
  const points = [];
  for (let frame = Math.round(from * 30); frame < Math.round(to * 30); frame++) {
    const where = place(frame / 30, frame);
    points.push(where ? point(frame / 30, where.x, where.y) : missing(frame / 30));
  }
  return points;
};
const flightTo = (start, from, to) =>
  at30(start, start + 0.5, (t) => {
    const u = (t - start) / 0.5;
    return { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u };
  });

test("the shuttle lying, being carried and held between rallies adds no rally", () => {
  const landing = { x: 0.5, y: 0.7 };
  const server = { x: 0.4, y: 0.75 };
  const points = [
    ...flightTo(0, { x: 0.5, y: 0.2 }, landing),
    // Lies for 7 s: a player walks past twice and the blob flickers by a cell.
    ...at30(0.5, 7.5, (t, frame) =>
      (t > 2 && t < 2.7) || (t > 5 && t < 5.4)
        ? null
        : { x: landing.x + (frame % 7 === 0 ? 1 / 512 : 0), y: landing.y },
    ),
    // Carried to the server, then held still before the serve.
    ...at30(7.5, 11, (t) => ({
      x: 0.5 - ((t - 7.5) / 3.5) * 0.1,
      y: 0.7 + ((t - 7.5) / 3.5) * 0.05,
    })),
    ...at30(11, 12.5, () => server),
    ...flightTo(12.5, server, { x: 0.6, y: 0.2 }),
    ...at30(13, 15, () => ({ x: 0.6, y: 0.2 })),
  ];
  const rallies = buildTrackNetRallies(points, H);
  assert.equal(rallies.length, 2);
  assert.ok(Math.abs(rallies[0].t - 0.5) < 0.1, "the first rally ends when the shuttle lands");
  assert.equal(rallies[0].countsTowardScore, true);
  // The held shuttle projects to the near half, so the near player served next.
  assert.equal(rallies[1].serveEnd, "near");
  assert.ok(Math.abs(rallies[1].startT - 12.5) < 0.1, `${rallies[1].startT}`);
});

test("a rally whose landing nobody saw is offered for review once the next one is served", () => {
  const points = [
    ...flightTo(0, { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.9 }),
    ...at30(0.5, 9, () => null),
    ...at30(9, 10, () => ({ x: 0.5, y: 0.25 })),
    ...flightTo(10, { x: 0.5, y: 0.25 }, { x: 0.5, y: 0.8 }),
    ...at30(10.5, 12, () => ({ x: 0.5, y: 0.8 })),
  ];
  const rallies = buildTrackNetRallies(points, H);
  assert.equal(rallies.length, 2);
  assert.equal(rallies[0].landingSeen, false);
  assert.equal(rallies[0].countsTowardScore, false);
  assert.equal(rallies[1].serveEnd, "far");
  // Without a following serve, a disappearance alone still proposes nothing.
  assert.equal(buildTrackNetRallies(points.slice(0, 15), H).length, 0);
});

test("a pickup shortly before the serve neither starts a rally nor hides the serve", () => {
  const landing = { x: 0.5, y: 0.3 };
  const server = { x: 0.6, y: 0.75 };
  const points = [
    ...flightTo(0, { x: 0.5, y: 0.8 }, landing),
    ...at30(0.5, 3.5, () => landing),
    // Scooped up with the racket: one fast step, then carried and held.
    ...at30(3.5, 3.54, () => ({ x: 0.5, y: 0.36 })),
    ...at30(3.54, 5.5, (t) => ({
      x: 0.5 + ((t - 3.54) / 2) * 0.1,
      y: 0.36 + ((t - 3.54) / 2) * 0.39,
    })),
    ...at30(5.5, 6.5, () => server),
    ...flightTo(6.5, server, { x: 0.4, y: 0.25 }),
    ...at30(7, 9, () => ({ x: 0.4, y: 0.25 })),
  ];
  const rallies = buildTrackNetRallies(points, H);
  assert.equal(rallies.length, 2);
  assert.ok(Math.abs(rallies[1].startT - 6.5) < 0.1, `${rallies[1].startT}`);
  assert.equal(rallies[1].serveEnd, "near");
});
