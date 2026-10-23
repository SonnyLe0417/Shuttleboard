import assert from "node:assert/strict";
import test from "node:test";
import { buildTrackNetRallies } from "../src/lib/tracknet-rally-scorer.ts";
import { rallyCountsTowardScore } from "../src/lib/analysis-results.ts";

const FPS = 30;
const IDENTITY_H = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function point(frame, x, y, visible = true) {
  return {
    frame,
    time: frame / FPS,
    x: visible ? x : null,
    y: visible ? y : null,
    confidence: visible ? 0.92 : 0,
    visible,
  };
}

function hold(startFrame, count, x, y, visible = true) {
  return Array.from({ length: count }, (_, i) => point(startFrame + i, x, y, visible));
}

function move(startFrame, count, x0, y0, x1, y1) {
  return Array.from({ length: count }, (_, i) => {
    const t = count <= 1 ? 1 : i / (count - 1);
    return point(startFrame + i, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
  });
}

function floorRest(startFrame = 0) {
  return hold(startFrame, 30, 0.41, 0.78);
}

function occlusionHole() {
  return [
    ...move(0, 18, 0.2, 0.3, 0.58, 0.42),
    ...hold(18, 25, 0, 0, false),
    ...move(43, 18, 0.58, 0.42, 0.35, 0.5),
  ];
}

test("a 0.80s visibility hole with motion on both sides does not score", () => {
  const rallies = buildTrackNetRallies(occlusionHole(), IDENTITY_H);
  assert.deepEqual(rallies, []);
  assert.equal(rallies.filter((rally) => rallyCountsTowardScore(rally)).length, 0);

  const scored = buildTrackNetRallies(floorRest(), IDENTITY_H);
  assert.equal(scored.length, 1);
  assert.equal(scored[0].winner, "p2");
  assert.equal(scored[0].countsTowardScore, true);
});

test("a visible still at 0.41,0.78 for 0.8s scores that spot for p2", () => {
  const rallies = buildTrackNetRallies(floorRest(), IDENTITY_H);
  assert.equal(rallies.length, 1);
  assert.equal(rallies[0].landingImgX, 0.41);
  assert.equal(rallies[0].landingImgY, 0.78);
  assert.equal(rallies[0].landingCourtX, 0.41);
  assert.equal(rallies[0].landingCourtY, 0.78);
  assert.equal(rallies[0].winner, "p2");
  assert.equal(rallies[0].inBounds, true);
  assert.equal(rallies[0].countsTowardScore, true);
  assert.equal(rallies[0].offCamera, false);
});

test("a still next to a fake player wrist does not score", () => {
  const points = floorRest();
  const withoutStub = buildTrackNetRallies(points, IDENTITY_H);
  assert.equal(withoutStub.length, 1);
  assert.equal(withoutStub[0].landingImgX, 0.41);
  assert.equal(withoutStub[0].landingImgY, 0.78);

  const withStub = buildTrackNetRallies(points, IDENTITY_H, {
    playerStubs: [{ x: 0.45, y: 0.8 }],
  });
  assert.deepEqual(withStub, []);
});

test("an upper-court still with no downward approach does not score", () => {
  const rallies = buildTrackNetRallies(hold(0, 30, 0.52, 0.22), IDENTITY_H);
  assert.deepEqual(rallies, []);

  const floor = buildTrackNetRallies(floorRest(), IDENTITY_H);
  assert.equal(floor.length, 1);
  assert.equal(floor[0].landingImgY, 0.78);
});

test("an off-camera rest emits a review rally that does not count", () => {
  const rallies = buildTrackNetRallies(hold(0, 30, 0.5, 0.1), IDENTITY_H);
  assert.equal(rallies.length, 1);
  assert.equal(rallies[0].winner, "p1");
  assert.equal(rallies[0].offCamera, true);
  assert.equal(rallies[0].countsTowardScore, false);
  assert.equal(rallies[0].needsReview, true);
});

test("an out-of-court rest still emits a review rally that does not count", () => {
  const scaleOut = [3, 0, 0, 0, 3, 0, 0, 0, 1];
  const rallies = buildTrackNetRallies(floorRest(), scaleOut);
  assert.equal(rallies.length, 1);
  assert.equal(rallies[0].winner, "p2");
  assert.equal(rallies[0].inBounds, false);
  assert.equal(rallies[0].countsTowardScore, false);
  assert.equal(rallies[0].needsReview, true);
  assert.match(rallies[0].reviewReasons.join(" "), /outside the court/);
});

test("invalid homography returns no rallies", () => {
  assert.deepEqual(buildTrackNetRallies(floorRest(), [1, 0, 0]), []);
  assert.deepEqual(buildTrackNetRallies(floorRest(), [NaN, 0, 0, 0, 1, 0, 0, 0, 1]), []);
  assert.deepEqual(buildTrackNetRallies(floorRest(), [0, 0, 0, 0, 0, 0, 0, 0, 0]), []);
});

test("two rests closer than 0.4s debounce to one rally", () => {
  const points = [
    ...hold(0, 30, 0.41, 0.78),
    ...hold(30, 7, 0, 0, false),
    ...hold(37, 30, 0.2, 0.7),
  ];
  const rallies = buildTrackNetRallies(points, IDENTITY_H);
  assert.equal(rallies.length, 1);
  assert.equal(rallies[0].landingImgX, 0.41);
  assert.equal(rallies[0].landingImgY, 0.78);
  assert.equal(rallies[0].winner, "p2");
});
