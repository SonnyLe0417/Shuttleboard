import test from "node:test";
import assert from "node:assert/strict";
import { landingVerdict } from "../src/lib/badminton.ts";
import { totalMatchPoints, matchToCsv } from "../src/lib/match-export.ts";
import { loadCourtCalibration, saveCourtCalibration } from "../src/lib/court-calibration.ts";

test("a landing outside a sideline is not close just because it is near the back line", () => {
  const verdict = landingVerdict(0, 0.001, "singles", false, true, 0);
  assert.equal(verdict.isIn, false);
  assert.equal(verdict.closeLine, false);
  assert.equal(verdict.nearestLine, "left sideline");
  assert.ok(verdict.lineMargin < 0);
});

test("a service fault measures the violated service boundary", () => {
  const verdict = landingVerdict(0.499, 0.5, "singles", true, true, 0);
  assert.equal(verdict.isIn, false);
  assert.equal(verdict.closeLine, false);
  assert.equal(verdict.nearestLine, "short service line");
});

test("valid and narrowly out landings retain close-line feedback", () => {
  for (const [x, expected] of [
    [0.088, true],
    [0.086, false],
    [0.087, true],
  ]) {
    const verdict = landingVerdict(x, 0.25, "singles", false, true, 0);
    assert.equal(verdict.isIn, expected);
    assert.equal(verdict.closeLine, true);
  }
});

test("match totals include prior games and count the retained final score once", () => {
  const first = { a: 21, b: 10 };
  assert.equal(totalMatchPoints({ completedGames: [], score: [3, 2], matchOver: false }), 5);
  assert.equal(totalMatchPoints({ completedGames: [first], score: [0, 0], matchOver: false }), 31);
  assert.equal(totalMatchPoints({ completedGames: [first], score: [4, 2], matchOver: false }), 37);
  assert.equal(
    totalMatchPoints({
      completedGames: [first, { a: 21, b: 12 }],
      score: [21, 12],
      matchOver: true,
    }),
    64,
  );
});

test("CSV quotes carriage returns in player names", () => {
  const csv = matchToCsv({
    preset: { label: "21" },
    names: ["A\rB", "C"],
    matchStartedAt: 0,
    log: [],
    games: [0, 0],
    longestRallyMs: 0,
  });
  assert.ok(csv.includes(',"A\rB",C,'));
});

test("saved calibration rejects nonnumeric and nonfinite matrix entries", () => {
  const corners = [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 0 },
    { x: 0, y: 0 },
  ];
  const matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  assert.ok(loadCourtCalibration(saveCourtCalibration(corners, matrix)));
  for (const invalid of [null, "1", Infinity, NaN]) {
    const homography = [...matrix];
    homography[0] = invalid;
    assert.equal(loadCourtCalibration(JSON.stringify({ corners, homography })), null);
    assert.equal(saveCourtCalibration(corners, homography), null);
  }
  assert.equal(saveCourtCalibration([{ x: NaN, y: 0 }, ...corners.slice(1)], matrix), null);
});
