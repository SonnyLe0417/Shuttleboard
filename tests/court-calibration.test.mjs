import test from "node:test";
import assert from "node:assert/strict";
import {
  addCourtCorner,
  courtDestinationCorners,
  hasFourCourtCorners,
  loadCourtCalibration,
  pointFromCanvasClick,
  saveCourtCalibration,
} from "../src/lib/court-calibration.ts";

test("keeps corners in tap order and ignores a fifth tap", () => {
  let corners = [];
  for (const point of [
    { x: 1, y: 2 },
    { x: 3, y: 4 },
    { x: 5, y: 6 },
    { x: 7, y: 8 },
    { x: 9, y: 10 },
  ]) {
    corners = addCourtCorner(corners, point);
  }
  assert.deepEqual(corners, [
    { x: 1, y: 2 },
    { x: 3, y: 4 },
    { x: 5, y: 6 },
    { x: 7, y: 8 },
  ]);
  assert.equal(hasFourCourtCorners(corners), true);
});

test("converts a screen tap into canvas coordinates", () => {
  assert.deepEqual(
    pointFromCanvasClick(150, 120, { left: 50, top: 20, width: 200, height: 100 }, 800, 400),
    { x: 400, y: 400 },
  );
});

test("creates and safely loads saved court settings", () => {
  const corners = [
    { x: 1, y: 2 },
    { x: 3, y: 4 },
    { x: 5, y: 6 },
    { x: 7, y: 8 },
  ];
  const homography = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  assert.deepEqual(loadCourtCalibration(saveCourtCalibration(corners, homography)), {
    corners,
    homography,
  });
  assert.equal(loadCourtCalibration("not json"), null);
  assert.equal(loadCourtCalibration(JSON.stringify({ corners: [{ x: 1, y: 2 }] })), null);
});

test("uses a normalized court shape", () => {
  assert.deepEqual(courtDestinationCorners(), [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 0 },
    { x: 0, y: 0 },
  ]);
});
