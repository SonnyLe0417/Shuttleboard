import test from "node:test";
import assert from "node:assert/strict";
import { createSessionStore } from "../src/lib/session-store.ts";
import { hasVisibleTrackNetPosition, trackNetVisualTrail } from "../src/lib/tracknet-evidence.ts";

test("session consumers share one subscription and newly mounted pages use the current session", () => {
  let connects = 0;
  let disconnects = 0;
  let publish;
  const store = createSessionStore((emit) => {
    connects++;
    publish = emit;
    return () => disconnects++;
  });
  const server = store.getServerSnapshot();
  const stopRoot = store.subscribe(() => {});
  const session = { user: { id: "one" } };
  publish(session);
  const stopPage = store.subscribe(() => {});
  assert.equal(connects, 1);
  assert.equal(store.getSnapshot().session, session);
  assert.equal(store.getSnapshot().loading, false);
  assert.equal(store.getServerSnapshot(), server);
  assert.equal(server.session, null);
  publish(null);
  assert.equal(store.getSnapshot().user, null);
  stopPage();
  assert.equal(disconnects, 0);
  stopRoot();
  assert.equal(disconnects, 1);
  assert.equal(store.getSnapshot().loading, true);
});

test("indexed TrackNet playback matches the original trail across forward and backward seeks", () => {
  const points = Array.from({ length: 1000 }, (_, frame) => ({
    frame,
    time: frame / 30,
    x: frame % 4 ? 0.5 : null,
    y: 0.3,
    visible: frame % 5 !== 0,
    repaired: frame % 3 === 0,
    confidence: 0.8,
  }));
  for (const time of [-1, 0, 12, 35, 7.1, 33, 0.1, Infinity]) {
    const expected = points
      .filter((point) => hasVisibleTrackNetPosition(point) && point.time <= time)
      .slice(-40);
    assert.deepEqual(trackNetVisualTrail(points, time), expected);
  }
  assert.deepEqual(trackNetVisualTrail(points, 10, 0), []);
  assert.deepEqual(trackNetVisualTrail(points, NaN), []);
});
