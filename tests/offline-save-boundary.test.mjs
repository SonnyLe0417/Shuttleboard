import test from "node:test";
import assert from "node:assert/strict";
import { loadRuntime } from "./fixtures/load-runtime.mjs";
import { insertOwnedMatch } from "../src/lib/match-save.server.ts";
const owner = "20000000-0000-4000-8000-000000000001",
  id = "20000000-0000-4000-8000-000000000010";
const payload = {
  client_match_id: id,
  expected_owner_id: owner,
  started_at: "2026-01-01T10:00:00Z",
  finished_at: "2026-01-01T10:10:00Z",
  mode: "singles",
  format: "Golden Point · Single",
  points_to_win: 21,
  best_of: 1,
  team_a_names: ["Fake A"],
  team_b_names: ["Fake B"],
  games: [{ a: 21, b: 10 }],
  winner: "A",
  duration_seconds: 600,
  status: "finished",
};
function createServerFn() {
  let validate;
  const builder = {
    middleware() {
      return builder;
    },
    validator(fn) {
      validate = fn;
      return builder;
    },
    handler(fn) {
      return (options) =>
        fn({ ...options, data: validate ? validate(options.data) : options.data });
    },
  };
  return builder;
}
async function functions(progress = async () => {}) {
  return loadRuntime("src/lib/matches.functions.ts", {
    "@tanstack/react-start": { createServerFn },
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
    "./preferences-patch": { mergePreferencePatch() {} },
    "@/lib/player-matches": { matchForPlayer() {} },
    "@/lib/growth.functions": {
      completeReferralForUser() {
        assert.fail("duplicate must not repeat referral effect");
      },
    },
    "./match-save.server": { insertOwnedMatch },
    "@/lib/progress.server": { synchronizeProgressForMatch: progress },
  });
}
test("offline save binds uploads to the verified owner and validates completed original timestamps", async () => {
  const loaded = await functions();
  const context = {
    userId: owner,
    supabase: {
      from() {
        assert.fail("validation/auth rejection must precede writes");
      },
    },
  };
  await assert.rejects(
    loaded.saveMatch({ data: { ...payload, expected_owner_id: id }, context }),
    /same account/,
  );
  for (const change of [
    { finished_at: "2025-01-01T00:00:00Z" },
    { duration_seconds: 1 },
    { games: [{ a: -1, b: 21 }] },
    { winner: null },
    { games: [{ a: 20, b: 20 }] },
    { started_at: undefined },
  ])
    await assert.rejects(
      async () => loaded.saveMatch({ data: { ...payload, ...change }, context }),
      /Validation/,
    );
  // New optional timestamps must also be safe for callers without an offline UUID.
  for (const change of [
    { started_at: undefined },
    { finished_at: undefined },
    { finished_at: "2099-01-01T00:00:00Z" },
    { status: "in_progress" },
  ])
    await assert.rejects(
      async () =>
        loaded.saveMatch({ data: { ...payload, client_match_id: undefined, ...change }, context }),
      /Validation/,
    );
});
test("duplicate save returns the original receipt and repairs progress without repeating creation effects", async () => {
  let repaired = 0;
  const loaded = await functions(async () => {
    repaired++;
  });
  const db = {
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
        maybeSingle: async () => ({ data: { id, creator_id: owner } }),
      };
      return q;
    },
  };
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        await loaded.saveMatch({ data: payload, context: { userId: owner, supabase: db } }),
      ),
    ),
    { id, progressPending: false },
  );
  assert.equal(repaired, 1);
});
