import test from "node:test";
import assert from "node:assert/strict";
import { createRallyEndState, updateRallyEndState } from "../src/lib/rally-end-detector.ts";
import { detectBirdieMotion } from "../src/lib/birdie-tracker.ts";
import { cornersForPlayerOne, judgeVisionLanding } from "../src/lib/vision-geometry.ts";
import { COURT_TO_IMAGE, IMAGE_CORNERS } from "./fixtures/annotation-trace.mjs";
import { applyHomography } from "../src/lib/birdie-tracker.ts";

const FPS = 30;
const seen = (time, x, y) => ({ time, x, y, visible: true, confidence: 0.9, cameraStable: true });
const unseen = (time) => ({
  time,
  x: null,
  y: null,
  visible: false,
  confidence: 0,
  cameraStable: true,
});

function feed(samples) {
  let state = createRallyEndState();
  const events = [];
  for (const sample of samples) {
    const result = updateRallyEndState(state, sample);
    state = result.state;
    if (result.event) events.push(result.event);
  }
  return events;
}

/** A shot falling onto the near half, then the shuttle lying still. */
function landing(restSeconds, place = (time, frame) => ({ x: 0.5, y: 0.75 })) {
  const samples = [];
  for (let frame = 0; frame < 15; frame++) samples.push(seen(frame / FPS, 0.5, 0.3 + frame * 0.03));
  for (let frame = 15; frame < 15 + restSeconds * FPS; frame++) {
    const where = place(frame / FPS, frame);
    samples.push(where ? seen(frame / FPS, where.x, where.y) : unseen(frame / FPS));
  }
  return samples;
}

test("a shuttle lying where it landed scores once, despite flicker and nudges", () => {
  // TrackNet-style one-cell flicker every 40 frames during a 12 s rest.
  const flicker = feed(
    landing(12, (_, frame) => ({ x: 0.5 + (frame % 40 === 0 ? 1 / 512 : 0), y: 0.75 })),
  );
  assert.equal(flicker.length, 1);
  assert.equal(flicker[0].type, "confirmed-end");
  // The rally ends when the shuttle stopped, not when the hold was confirmed.
  const [clean] = feed(landing(3));
  assert.ok(Math.abs(clean.landingTime - 0.5) < 0.05, `${clean.landingTime}`);
  assert.ok(clean.point.time - clean.landingTime >= 1);
  const nudged = feed(landing(6, (t) => ({ x: t > 2.5 ? 0.503 : 0.5, y: 0.75 })));
  assert.equal(nudged.length, 1);
});

test("a pickup and a held serve do not confirm another point", () => {
  const events = feed(
    landing(8, (t) => {
      if (t < 2.2) return { x: 0.5, y: 0.75 };
      if (t < 5) return null; // a player stands over it
      if (t < 6) return { x: 0.5, y: 0.85 - (t - 5) * 0.1 }; // picked up and walked back
      return { x: 0.5, y: 0.75 }; // held still before serving
    }),
  );
  assert.equal(events.filter((event) => event.type === "confirmed-end").length, 1);
});

test("a vanished shuttle reports where it was last seen, not a landing", () => {
  const events = feed([...landing(0), unseen(0.6), unseen(1.2), unseen(1.8)]);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "needs-review");
  assert.equal(events[0].landingSeen, false);
});

test("camera shift is a fraction of the frame in every tracker branch", () => {
  const width = 64;
  const height = 36;
  const frame = new Uint8ClampedArray(width * height * 4).fill(90);
  const first = detectBirdieMotion(frame, null, null, width, height, 0);
  // No candidate, flat background: every translation ties, so there is no shift.
  const none = detectBirdieMotion(frame, first.gray, null, width, height, 33);
  assert.deepEqual(none.cameraShift, { x: 0, y: 0 });
  const prior = {
    x: 0.5,
    y: 0.5,
    vx: 0,
    vy: 0,
    ax: 0,
    ay: 0,
    lastSeen: 40,
    updatedAt: 40,
    confidence: 0.9,
    uncertainty: 0.1,
    visible: true,
    hits: 5,
  };
  const coasting = detectBirdieMotion(frame, first.gray, prior, width, height, 66);
  assert.ok(Math.hypot(coasting.cameraShift.x, coasting.cameraShift.y) < 0.003);
});

test("vision landings are judged on the calibrated court and from player 1's end", () => {
  const at = (x, y) => applyHomography(COURT_TO_IMAGE, { x, y });
  assert.deepEqual(judgeVisionLanding(at(0.5, 0.6), IMAGE_CORNERS, "singles").pointTo, "p2");
  // After the change of ends player 1 is at the far end: the same spot is p2's half.
  const swapped = cornersForPlayerOne(IMAGE_CORNERS, false);
  assert.deepEqual(swapped, [
    IMAGE_CORNERS[3],
    IMAGE_CORNERS[2],
    IMAGE_CORNERS[1],
    IMAGE_CORNERS[0],
  ]);
  assert.equal(judgeVisionLanding(at(0.5, 0.6), swapped, "singles").pointTo, "p1");
  assert.equal(judgeVisionLanding(at(0.04, 0.6), IMAGE_CORNERS, "doubles").call, "in");
  assert.equal(judgeVisionLanding(at(0.04, 0.6), IMAGE_CORNERS, "singles").call, "out");
});
