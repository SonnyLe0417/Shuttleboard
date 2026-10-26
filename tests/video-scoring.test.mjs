import assert from "node:assert/strict";
import test from "node:test";
import { createRallyEndState, updateRallyEndState } from "../src/lib/rally-end-detector.ts";
import {
  closeCameraSegment,
  createCameraMotionState,
  createCameraSegment,
  segmentForTime,
  updateCameraMotion,
} from "../src/lib/video-camera-segments.ts";

function sample(time, x, y, extras = {}) {
  return {
    time,
    x,
    y,
    visible: x !== null && y !== null,
    confidence: 0.9,
    cameraStable: true,
    ...extras,
  };
}

function feed(samples) {
  let state = createRallyEndState();
  const events = [];
  for (const current of samples) {
    const result = updateRallyEndState(state, current);
    state = result.state;
    if (result.event) events.push(result.event);
  }
  return { state, events };
}

test("shuttle stopping for one second confirms a possible point", () => {
  const result = feed([
    sample(0, 0.2, 0.2),
    sample(0.2, 0.5, 0.4),
    sample(0.4, 0.7, 0.6),
    sample(0.8, 0.7, 0.6),
    sample(1.9, 0.7, 0.6),
  ]);

  assert.equal(result.events[0].type, "confirmed-end");
});

test("shuttle disappearance does not create an automatic point", () => {
  const result = feed([
    sample(0, 0.2, 0.2),
    sample(0.2, 0.5, 0.4),
    sample(0.4, 0.7, 0.6),
    sample(1.5, null, null),
  ]);

  assert.equal(result.events[0].type, "needs-review");
  assert.match(result.events[0].reasons.join(" "), /disappeared/);
});

test("player movement makes a possible landing need review", () => {
  const result = feed([
    sample(0, 0.2, 0.2),
    sample(0.2, 0.5, 0.4),
    sample(0.4, 0.7, 0.6),
    sample(0.8, 0.7, 0.6, { playerMotion: 0.9 }),
    sample(1.9, 0.7, 0.6, { playerMotion: 0.9 }),
  ]);

  assert.equal(result.events[0].type, "needs-review");
  assert.match(result.events[0].reasons.join(" "), /players/);
});

test("a new hit cancels a possible point", () => {
  const result = feed([
    sample(0, 0.2, 0.2),
    sample(0.2, 0.5, 0.4),
    sample(0.4, 0.7, 0.6),
    sample(0.8, 0.7, 0.6),
    sample(1.1, 0.8, 0.75),
    sample(1.5, 0.4, 0.8),
  ]);

  assert.equal(result.events.length, 0);
  assert.equal(result.state.phase, "active");
});

test("a confirmed point locks once and the next rally can score", () => {
  // Between rallies the shuttle lies still while the next serve is set up.
  const result = feed([
    sample(0, 0.2, 0.2),
    sample(0.2, 0.5, 0.4),
    sample(0.4, 0.7, 0.6),
    sample(0.8, 0.7, 0.6),
    sample(1.9, 0.7, 0.6),
    sample(2.1, 0.7, 0.6),
    sample(7.4, 0.2, 0.2),
    sample(7.6, 0.5, 0.4),
    sample(7.8, 0.7, 0.6),
    sample(8.2, 0.7, 0.6),
    sample(9.3, 0.7, 0.6),
  ]);

  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].type, "confirmed-end");
  assert.equal(result.events[1].type, "confirmed-end");
});

test("small camera movement does not pause analysis", () => {
  let state = createCameraMotionState();
  state = updateCameraMotion(state, { x: 0.001, y: 0.001 }, 1).state;
  state = updateCameraMotion(state, { x: 0.001, y: 0.001 }, 2).state;
  const result = updateCameraMotion(state, { x: 0.001, y: 0.001 }, 3);
  assert.equal(result.needsRecalibration, false);
});

test("large camera movement requests new corners after three frames", () => {
  let state = createCameraMotionState();
  state = updateCameraMotion(state, { x: 0.008, y: 0 }, 1).state;
  state = updateCameraMotion(state, { x: 0.008, y: 0 }, 2).state;
  const result = updateCameraMotion(state, { x: 0.008, y: 0 }, 3);
  assert.equal(result.needsRecalibration, true);
});

test("each camera segment keeps its own corners and homography", () => {
  const first = createCameraSegment(1, 0, "birds-eye", [{ x: 0, y: 1 }], [], [1, 0, 0]);
  const second = createCameraSegment(2, 20, "side-angle", [{ x: 1, y: 0 }], [], [2, 0, 0]);
  const closed = [...closeCameraSegment([first], 20), second];

  assert.equal(closed[0].endTime, 20);
  assert.equal(segmentForTime(closed, 5).homography[0], 1);
  assert.equal(segmentForTime(closed, 25).homography[0], 2);
});
