import test from "node:test";
import assert from "node:assert/strict";
import {
  COURT,
  COURT_LENGTH_M,
  COURT_WIDTH_M,
  activeLandingBox,
  imageSide,
  inNormalCourt,
  inServiceCourt,
  landingVerdict,
  rallyLanding,
  receiverCourt,
} from "../src/lib/badminton.ts";
import { applyHomography, computeHomography } from "../src/lib/birdie-tracker.ts";
import { courtDestinationCorners } from "../src/lib/court-calibration.ts";

const close = (actual, expected, tolerance = 0.005) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`);

test("court lines sit where the BWF laws put them", () => {
  close(COURT.singlesSideline * COURT_WIDTH_M, 0.46);
  close((COURT.center - COURT.shortServiceY) * COURT_LENGTH_M, 1.98);
  close(COURT.doublesLongServiceY * COURT_LENGTH_M, 0.76);
  // 48 cm from the doubles edge is inside the singles court; lines are in.
  assert.equal(inNormalCourt(0.48 / COURT_WIDTH_M, 0.25, "singles"), true);
  assert.equal(inNormalCourt(0.4 / COURT_WIDTH_M, 0.25, "singles"), false);
  assert.equal(inNormalCourt(0.4 / COURT_WIDTH_M, 0.25, "doubles"), true);
  // A doubles serve 0.9 m inside the far back boundary is good.
  assert.equal(inServiceCourt(0.3, 0.9 / COURT_LENGTH_M, "doubles", true, 0), true);
  assert.equal(inServiceCourt(0.3, 0.7 / COURT_LENGTH_M, "doubles", true, 0), false);
});

test("the receiver's court is named like the server's and mirrored for the far end", () => {
  assert.equal(receiverCourt(0), "right");
  assert.equal(receiverCourt(7), "left");
  assert.equal(imageSide("right", true), "right");
  assert.equal(imageSide("right", false), "left");
});

test("serves are judged diagonally from either end of the court", () => {
  const cases = [
    // [server at near end, server score, legal landing, straight landing]
    [true, 0, [0.3, 0.2], [0.7, 0.2]],
    [true, 1, [0.7, 0.2], [0.3, 0.2]],
    [false, 0, [0.7, 0.8], [0.3, 0.8]],
    [false, 1, [0.3, 0.8], [0.7, 0.8]],
  ];
  for (const [nearSide, score, legal, straight] of cases) {
    for (const mode of ["singles", "doubles"]) {
      assert.equal(inServiceCourt(...legal, mode, nearSide, score), true, `${nearSide} ${score}`);
      assert.equal(inServiceCourt(...straight, mode, nearSide, score), false);
      const box = activeLandingBox(mode, true, nearSide, score);
      assert.ok(legal[0] >= box.xMin && legal[0] <= box.xMax);
      assert.ok(legal[1] >= box.yMin && legal[1] <= box.yMax);
    }
  }
  assert.equal(activeLandingBox("singles", true, false, 0).xMin, 0.5);
  assert.match(landingVerdict(0.3, 0.2, "singles", true, true, 0).modeText, /receiver's right/);
});

test("close calls are measured in metres on both axes", () => {
  // 0.50 m inside the singles sideline and 0.90 m inside the back line.
  const x = COURT.singlesSideline + 0.5 / COURT_WIDTH_M;
  const verdict = landingVerdict(x, 1 - 0.9 / COURT_LENGTH_M, "singles", false, true, 0);
  assert.equal(verdict.nearestLine, "left sideline");
  assert.equal(verdict.lineMarginCm, 50);
  assert.equal(verdict.closeLine, false);
  const baseline = landingVerdict(0.5, 1 - 0.1 / COURT_LENGTH_M, "singles", false, true, 0);
  assert.equal(baseline.nearestLine, "near back line");
  assert.equal(baseline.lineMarginCm, 10);
  assert.equal(baseline.closeLine, true);
});

test("a rally landing favours the end that did not lose it", () => {
  // In court at the near end: the near player loses.
  assert.deepEqual(rallyLanding(0.5, 0.8, "singles"), {
    end: "near",
    isIn: true,
    winnerEnd: "far",
  });
  // Long past the far back line: the far player wins.
  assert.deepEqual(rallyLanding(0.5, -0.03, "singles"), {
    end: "far",
    isIn: false,
    winnerEnd: "far",
  });
  // Wide into the far doubles alley is out in singles and in for doubles.
  assert.equal(rallyLanding(0.05, 0.25, "singles").winnerEnd, "far");
  assert.equal(rallyLanding(0.05, 0.25, "doubles").winnerEnd, "near");
});

test("the calibration homography maps the tapped corners onto the normalized court", () => {
  const tapped = [
    { x: 0.14, y: 0.93 },
    { x: 0.86, y: 0.93 },
    { x: 0.7, y: 0.3 },
    { x: 0.3, y: 0.3 },
  ];
  const H = computeHomography(tapped, courtDestinationCorners());
  for (const [i, corner] of courtDestinationCorners().entries()) {
    const mapped = applyHomography(H, tapped[i]);
    close(mapped.x, corner.x, 1e-9);
    close(mapped.y, corner.y, 1e-9);
  }
  assert.ok(applyHomography(H, { x: 0.5, y: 0.98 }).y > 1);
  assert.ok(applyHomography(H, { x: 0.5, y: 0.25 }).y < 0);
});
