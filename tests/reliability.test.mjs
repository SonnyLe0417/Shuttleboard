import test from "node:test";
import assert from "node:assert/strict";
import {
  matchForPlayer,
  isCompletedMatch,
  levelBounds,
  levelForXp,
} from "../src/lib/player-matches.ts";
import { ACHIEVEMENTS, eligibleAchievements } from "../src/lib/achievement-catalog.ts";
import {
  authorizeAccountDeletion,
  hasRecentOAuthAuthentication,
} from "../src/lib/account-deletion.ts";
import { openLiveTrackNet } from "../src/lib/live-tracknet-connection.ts";
import { LiveRally } from "../src/lib/live-rally.ts";

const match = {
  id: "one",
  winner: "B",
  status: "finished",
  team_a_user_ids: ["a"],
  team_b_user_ids: ["b"],
  games: [{ a: 5, b: 21 }],
  started_at: "2026-09-01T12:00:00Z",
};
test("Team B gets its own victory and score without mutating saved data", () => {
  const view = matchForPlayer(match, "b");
  assert.equal(view.winner, "A");
  assert.deepEqual(view.games, [{ a: 21, b: 5 }]);
  assert.equal(match.winner, "B");
  assert.equal(matchForPlayer(match, "a"), match);
  assert.equal(isCompletedMatch({ ...match, status: "abandoned" }), false);
});
test("all ten catalog achievements have reachable server conditions", () => {
  const matches = Array.from({ length: 5 }, (_, i) => ({
    ...match,
    id: String(i),
    winner: "A",
    best_of: 3,
    games: [
      { a: 5, b: 21 },
      { a: 21, b: 3 },
      { a: 21, b: 4 },
    ],
  }));
  const quests = Array.from({ length: 3 }, () => ({
    status: "completed",
    starts_at: "2026-09-01",
    ends_at: "2026-10-01",
  }));
  const earned = eligibleAchievements(
    matches,
    Array.from({ length: 5 }, () => ({ next_focus: "serve" })),
    [{}],
    quests,
    [{ next_plan: "vary serve" }],
  );
  assert.equal(earned.length, 10);
  assert.deepEqual(
    new Set(earned.map((a) => a.achievement_key)),
    new Set(ACHIEVEMENTS.map((a) => a[0])),
  );
  assert.equal(eligibleAchievements([], [], [], [], []).length, 0);
  assert.equal(
    eligibleAchievements(
      [{ ...match, status: "abandoned" }],
      [{ went_well: " " }],
      [],
      [],
      [{ next_plan: " " }],
    ).length,
    0,
  );
});
test("levels progress from the current threshold, with a true zero", () => {
  assert.equal(levelBounds(0).percent, 0);
  assert.equal(levelBounds(100).percent, 0);
  assert.equal(levelBounds(175).percent, 50);
  assert.equal(levelForXp(3200), 9);
  assert.equal(levelBounds(3200).end, 3900);
});
const now = Date.now() / 1000;
const base = {
  userId: "owner",
  user: { id: "owner", email: "owner@example.test", identities: [{ provider: "email" }] },
  claims: { sub: "owner" },
  verifyPassword: async () => "owner",
};
test("deletion blocks bypassing the UI with confirmation alone", async () => {
  await assert.rejects(authorizeAccountDeletion(base), /Reauthenticate/);
  await assert.rejects(
    authorizeAccountDeletion({ ...base, password: "wrong", verifyPassword: async () => null }),
    /password/,
  );
  await assert.rejects(
    authorizeAccountDeletion({ ...base, password: "test", verifyPassword: async () => "other" }),
    /password/,
  );
  await assert.rejects(
    authorizeAccountDeletion({ ...base, password: "test", user: null }),
    /session/,
  );
  await assert.rejects(
    authorizeAccountDeletion({ ...base, password: "test", claims: { sub: "other" } }),
    /session/,
  );
});
test("deletion allows verified same-user password and recent Google OAuth only", async () => {
  await authorizeAccountDeletion({ ...base, password: "current" });
  const oauth = {
    ...base,
    user: { ...base.user, identities: [{ provider: "google" }] },
    claims: { sub: "owner", amr: [{ method: "oauth", timestamp: now - 20 }] },
  };
  await authorizeAccountDeletion(oauth);
  await assert.rejects(
    authorizeAccountDeletion({
      ...oauth,
      claims: { sub: "owner", amr: [{ method: "oauth", timestamp: now - 600 }] },
    }),
    /Reauthenticate/,
  );
  assert.equal(
    hasRecentOAuthAuthentication({ amr: [{ method: "token_refresh", timestamp: now }] }, now),
    false,
  );
  assert.equal(
    hasRecentOAuthAuthentication({ amr: [{ method: "oauth", timestamp: now + 600 }] }, now),
    false,
  );
});
class Socket {
  static OPEN = 1;
  static current;
  readyState = 1;
  sent = [];
  closed = false;
  constructor() {
    Socket.current = this;
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
  message(data) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}
test("TrackNet ready/frame watchdogs, matching frames and cancellation", async () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  try {
    await assert.rejects(
      openLiveTrackNet("ws://test", () => {}, undefined, undefined, { readyTimeoutMs: 15 }),
      /ready/,
    );
    const messages = [],
      errors = [];
    const pending = openLiveTrackNet(
      "ws://test",
      (m) => messages.push(m),
      (e) => errors.push(e.type),
      undefined,
      { frameTimeoutMs: 20 },
    );
    const socket = Socket.current;
    socket.message({ type: "ready" });
    const connection = await pending;
    connection.sendFrame("image", 1, 1);
    connection.sendFrame("image", 2, 2);
    assert.equal(socket.sent.length, 1);
    socket.message({ type: "detection", frame: 99, visible: false, confidence: 0 });
    assert.equal(messages.length, 1);
    socket.message({ type: "detection", frame: 1, visible: true, confidence: 0.8, x: 0.4, y: 0.6 });
    assert.equal(messages.length, 2);
    connection.sendFrame("image", 2, 2);
    await new Promise((r) => setTimeout(r, 35));
    assert.deepEqual(errors, ["frame-timeout"]);
    assert.equal(socket.closed, true);
    const controller = new AbortController();
    const cancelled = openLiveTrackNet("ws://test", () => {}, undefined, undefined, {
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(cancelled, /cancelled/);
    const invalid = openLiveTrackNet("ws://test", () => {});
    Socket.current.message({ type: "detection", visible: true, confidence: 2 });
    await assert.rejects(invalid, /invalid/);
  } finally {
    globalThis.WebSocket = original;
  }
});
test("stationary object and weak detections never auto-award a rally", () => {
  const rally = new LiveRally();
  for (let i = 1; i < 100; i++) assert.equal(rally.update(0.5, 0.5, 0.95, i * 100), null);
  for (let i = 100; i < 150; i++) assert.equal(rally.update(null, null, 0, i * 100), null);
});
