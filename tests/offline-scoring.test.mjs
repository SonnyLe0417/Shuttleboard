import test from "node:test";
import assert from "node:assert/strict";
import {
  createDurableController,
  reduceDurableMatch,
  completionTime,
} from "../src/lib/durable-match-controller.ts";
import { completedOfflineMatch, restoreLegacyOfflineDraft } from "../src/lib/offline-result.ts";
import { insertOwnedMatch } from "../src/lib/match-save.server.ts";
function complete() {
  let c = createDurableController();
  c = reduceDurableMatch(c, { type: "preset", id: "golden", at: 1000 }, true);
  for (let n = 0; n < 21; n++)
    c = reduceDurableMatch(
      c,
      { type: "point", team: 0, reason: "point", at: 2000 + n * 1000 },
      true,
    );
  return c;
}
test("an owned draft restores its bounded undo history", () => {
  let current = createDurableController();
  for (let n = 0; n < 2; n++)
    current = reduceDurableMatch(
      current,
      { type: "point", team: 0, reason: "point", at: 2000 + n },
      true,
    );
  const restored = reduceDurableMatch(
    createDurableController(),
    { type: "restore", match: current.match, history: current.history },
    true,
  );
  assert.deepEqual(reduceDurableMatch(restored, { type: "undo" }, true).match.score, [1, 0]);
});
test("durable completion blocks reset/preset/undo until the exact result is queued", () => {
  const c = complete();
  assert.equal(c.match.matchOver, true);
  for (const action of [
    { type: "reset" },
    { type: "preset", id: "11", at: 50000 },
    { type: "undo" },
  ])
    assert.equal(reduceDurableMatch(c, action, true), c);
  assert.equal(
    reduceDurableMatch(
      reduceDurableMatch(c, { type: "device-saved", endedAt: completionTime(c.match) }, true),
      { type: "reset" },
      true,
    ).match.matchOver,
    false,
  );
  assert.equal(
    reduceDurableMatch(
      reduceDurableMatch(c, { type: "device-saved", endedAt: 1 }, true),
      { type: "reset" },
      true,
    ).match.matchOver,
    true,
  );
});
test("queued results freeze identity, original dates, names, scores and durations", () => {
  const c = complete(),
    queued = completedOfflineMatch("owner", "match-id", c.match, { court: "Test court" });
  assert.equal(queued.payload.expected_owner_id, "owner");
  assert.equal(queued.payload.duration_seconds, 20);
  assert.equal(queued.payload.started_at, new Date(2000).toISOString());
  assert.equal(queued.payload.finished_at, new Date(22000).toISOString());
  c.match.completedGames[0].a = 99;
  c.match.names[0] = "Changed";
  assert.equal(queued.payload.games[0].a, 21);
  assert.equal(queued.payload.team_a_names[0], "Team A");
  assert.equal(queued.payload.court_name, "Test court");
});
test("legacy adoption validates the whole draft and reconstructs trusted presets", () => {
  const state = complete().match;
  assert.deepEqual(restoreLegacyOfflineDraft(JSON.stringify(state)).score, state.score);
  assert.throws(() => restoreLegacyOfflineDraft(JSON.stringify({ ...state, names: null })));
  assert.throws(() =>
    restoreLegacyOfflineDraft(JSON.stringify({ ...state, log: [{ text: "x" }] })),
  );
});
test("duplicate saves return the existing owned receipt without overwriting", async () => {
  let inserts = 0,
    reads = 0;
  const db = {
    from() {
      const query = {
        insert() {
          inserts++;
          return query;
        },
        select() {
          return query;
        },
        eq() {
          return query;
        },
        single: async () => ({ error: { code: "23505" } }),
        maybeSingle: async () => {
          reads++;
          return { data: { id: "stable", creator_id: "owner" } };
        },
      };
      return query;
    },
  };
  assert.deepEqual(await insertOwnedMatch(db, "owner", { id: "stable" }), {
    data: { id: "stable" },
    error: null,
    created: false,
  });
  assert.equal(inserts, 1);
  assert.equal(reads, 1);
  await assert.rejects(
    insertOwnedMatch(
      {
        from() {
          const q = {
            insert() {
              return q;
            },
            select() {
              return q;
            },
            eq() {
              return q;
            },
            single: async () => ({ error: { code: "23505" } }),
            maybeSingle: async () => ({ data: null }),
          };
          return q;
        },
      },
      "other",
      { id: "stable" },
    ),
    /unavailable/,
  );
});
