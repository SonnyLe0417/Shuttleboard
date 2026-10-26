import test from "node:test";
import assert from "node:assert/strict";
import { createRallyEndState, updateRallyEndState } from "../src/lib/rally-end-detector.ts";
import { detectBirdieMotion } from "../src/lib/birdie-tracker.ts";
import { createCameraMotionState, updateCameraMotion } from "../src/lib/video-camera-segments.ts";
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
  // Anything else it reports carries no landing, so it cannot hand out a point.
  assert.equal(events.filter((event) => event.landingSeen).length, 1);
});

test("a shuttle knocked back or swept away soon after a point is not a new rally", () => {
  const knocked = feed(
    landing(8, (t) => {
      if (t < 3.5) return { x: 0.5, y: 0.75 };
      // Tapped back over the net 3.5 s later, dropping on the far side.
      if (t < 4.1) return { x: 0.5, y: 0.75 - (t - 3.5) * 0.7 };
      return { x: 0.5, y: 0.33 };
    }),
  );
  assert.equal(knocked.filter((event) => event.landingSeen).length, 1);
  const swept = feed(
    landing(6, (t) =>
      t < 2.5 ? { x: 0.5, y: 0.75 } : { x: 0.5, y: Math.min(0.84, 0.75 + (t - 2.5) * 0.3) },
    ),
  );
  assert.equal(swept.filter((event) => event.landingSeen).length, 1);
});

test("a stop long after the shuttle last came down is not a seen landing", () => {
  const samples = [];
  for (let frame = 0; frame < 15; frame++) samples.push(seen(frame / FPS, 0.5, 0.3 + frame * 0.03));
  // Then 1.5 s sideways at one height (rolling, or carried at a run), then still.
  for (let frame = 15; frame < 60; frame++)
    samples.push(seen(frame / FPS, 0.2 + frame * 0.01, 0.72));
  for (let frame = 60; frame < 120; frame++) samples.push(seen(frame / FPS, 0.8, 0.72));
  const events = feed(samples);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "needs-review");
  assert.equal(events[0].landingSeen, false);
});

test("sightings too far apart in time say nothing about the shuttle being still", () => {
  const events = feed([
    ...landing(0),
    // Seen at the same spot every 0.6 s: no proof that it stayed there in between.
    ...[1.1, 1.7, 2.3, 2.9, 3.5].map((time) => seen(time, 0.5, 0.75)),
  ]);
  assert.equal(events.length, 0);
});

test("a vanished shuttle reports where it was last seen, not a landing", () => {
  const events = feed([...landing(0), unseen(0.6), unseen(1.2), unseen(1.8)]);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "needs-review");
  assert.equal(events[0].landingSeen, false);
});

test("a slow pan asks for new corners while jitter does not", () => {
  const run = (shiftAt) => {
    let state = createCameraMotionState();
    for (let frame = 1; frame <= 90; frame++) {
      const result = updateCameraMotion(state, shiftAt(frame), frame / 30);
      if (result.needsRecalibration) return frame;
      state = result.state;
    }
    return null;
  };
  // Two pixels a frame at 640 px: under the per-frame limit, but the court moves.
  assert.ok(run(() => ({ x: 2 / 640, y: 0 })) <= 15);
  // One-pixel wobble that cancels out never does.
  assert.equal(
    run((frame) => ({ x: (frame % 2 ? 1 : -1) / 640, y: 0 })),
    null,
  );
});

test("camera shift is a fraction of the frame in every tracker branch", () => {
  const width = 160;
  const height = 90;
  // A dim, irregular background (no shuttle-like blobs), moved right by 2 px.
  const texture = (x, y) => 40 + ((x * 37 + y * 91 + ((x * y) % 13) * 7) % 90);
  const frame = (dx) => {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const value = texture(x - dx, y);
        rgba.set([value, value, value, 255], (y * width + x) * 4);
      }
    return rgba;
  };
  const first = detectBirdieMotion(frame(0), null, null, width, height, 0);
  const expected = { x: 2 / width, y: 0 };
  const close = (shift) =>
    assert.ok(Math.hypot(shift.x - expected.x, shift.y - expected.y) < 1e-9, JSON.stringify(shift));
  // No track yet.
  close(detectBirdieMotion(frame(2), first.gray, null, width, height, 33).cameraShift);
  // Coasting on a track seen a moment ago.
  const prior = {
    x: 0.5,
    y: 0.5,
    vx: 0,
    vy: 0,
    ax: 0,
    ay: 0,
    lastSeen: 20,
    updatedAt: 20,
    confidence: 0.9,
    uncertainty: 0.1,
    visible: true,
    hits: 5,
  };
  close(detectBirdieMotion(frame(2), first.gray, prior, width, height, 33).cameraShift);
  // A flat picture: every shift ties, so there is none.
  const flat = new Uint8ClampedArray(width * height * 4).fill(90);
  const still = detectBirdieMotion(
    flat,
    detectBirdieMotion(flat, null, null, width, height, 0).gray,
    null,
    width,
    height,
    33,
  );
  assert.deepEqual(still.cameraShift, { x: 0, y: 0 });
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
