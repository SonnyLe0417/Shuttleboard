import test from "node:test";
import assert from "node:assert/strict";
import { loadRuntime } from "./fixtures/load-runtime.mjs";
import { insertOwnedMatch } from "../src/lib/match-save.server.ts";
import * as rules from "../src/lib/badminton-rules.ts";
import {
  findPreset,
  isGameOver,
  isGamePoint,
  isLegalGameScore,
  isMatchPoint,
  matchResultProblem,
  pointCall,
  rulesForResult,
} from "../src/lib/badminton-rules.ts";

const r21 = findPreset("21");
const r15 = findPreset("15");
const golden = findPreset("golden");
// The annotated singles match: p1 is team A, p2 is team B.
const ANNOTATED = [
  { a: 18, b: 21 },
  { a: 12, b: 21 },
];

test("3x15 games need two clear points from 14-all and end at 21", () => {
  assert.equal(isGameOver([15, 13], r15), true);
  assert.equal(isGameOver([15, 14], r15), false);
  assert.equal(isGameOver([16, 14], r15), true);
  assert.equal(isGameOver([20, 19], r15), false);
  assert.equal(isGameOver([20, 20], r15), false);
  assert.equal(isGameOver([21, 20], r15), true);
});

test("game point and match point depend on the games already won", () => {
  // Game 1 of the annotated match at 17-20: a game point for p2, not a match point.
  assert.equal(pointCall([17, 20], [0, 0], 1, r21), "game");
  assert.equal(pointCall([17, 20], [0, 0], 0, r21), null);
  assert.equal(isMatchPoint([17, 20], [0, 0], r21), false);
  // Game 2 at 12-20 with p2 a game up: now it is match point.
  assert.equal(pointCall([12, 20], [0, 1], 1, r21), "match");
  assert.equal(isMatchPoint([12, 20], [0, 1], r21), true);
  // Deuce needs two more points; 29-all is game point for both.
  assert.equal(isGamePoint([20, 20], r21), false);
  assert.equal(pointCall([29, 29], [1, 0], 0, r21), "match");
  assert.equal(pointCall([29, 29], [1, 0], 1, r21), "game");
  // A golden point decides the single game outright.
  assert.equal(pointCall([20, 20], [0, 0], 0, golden), "match");
  assert.equal(pointCall([21, 3], [0, 0], 0, r21), null);
});

test("only scores the rules can finish on are legal game results", () => {
  for (const [a, b] of [
    [21, 19],
    [22, 20],
    [29, 27],
    [30, 28],
    [30, 29],
    [21, 0],
    [18, 21],
  ])
    assert.equal(isLegalGameScore({ a, b }, r21), true, `${a}-${b}`);
  for (const [a, b] of [
    [21, 20],
    [22, 19],
    [30, 27],
    [31, 29],
    [20, 18],
    [21, 21],
  ])
    assert.equal(isLegalGameScore({ a, b }, r21), false, `${a}-${b}`);
  assert.equal(isLegalGameScore({ a: 21, b: 20 }, golden), true);
  assert.equal(isLegalGameScore({ a: 22, b: 20 }, golden), false);
  assert.equal(isLegalGameScore({ a: 21, b: 20 }, r15), true);
});

test("a result must be reachable and its winner must match the games", () => {
  const options = { bestOf: 3, complete: true };
  assert.equal(matchResultProblem(ANNOTATED, "B", r21, options), null);
  assert.match(matchResultProblem(ANNOTATED, "A", r21, options), /team B, who won 2 of 2/);
  assert.match(matchResultProblem(ANNOTATED, null, r21, options), /team B/);
  assert.match(
    matchResultProblem([...ANNOTATED, { a: 21, b: 0 }], "B", r21, options),
    /game 3 was played after the match was already decided/,
  );
  assert.match(matchResultProblem([{ a: 21, b: 20 }], "A", r21, options), /not a finished/);
  assert.match(matchResultProblem([{ a: 21, b: 21 }], null, r21, options), /tied/);
  assert.match(matchResultProblem([{ a: 21, b: 15 }], "A", r21, options), /not finished/);
  // A casually logged single game may stand for a shortened match.
  assert.equal(
    matchResultProblem([{ a: 21, b: 15 }], "A", r21, { bestOf: 3, complete: false }),
    null,
  );
  // Unknown formats still check that the winner won more games.
  assert.match(
    matchResultProblem([{ a: 3, b: 7 }], "A", null, { bestOf: 1, complete: false }),
    /team B/,
  );
});

test("saved results are matched to the preset they were scored with", () => {
  assert.equal(rulesForResult(21, 3, "21 · Best of 3").cap, 30);
  assert.equal(rulesForResult(21, 1, "Golden Point · Single").decidingPoint, true);
  assert.equal(rulesForResult(21, 3, "21-point").id, "21");
  assert.equal(rulesForResult(15, 3, "15 · Best of 3").cap, 21);
  assert.equal(rulesForResult(17, 3, "17-point"), null);
});

const owner = "20000000-0000-4000-8000-000000000001";
function createServerFn() {
  let validate;
  const builder = {
    middleware: () => builder,
    validator(fn) {
      validate = fn;
      return builder;
    },
    handler: (fn) => (options) =>
      fn({ ...options, data: validate ? validate(options.data) : options.data }),
  };
  return builder;
}

async function saveWith(inserted) {
  const loaded = await loadRuntime("src/lib/matches.functions.ts", {
    "@tanstack/react-start": { createServerFn },
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
    "./preferences-patch": { mergePreferencePatch() {} },
    "@/lib/player-matches": { matchForPlayer() {} },
    "@/lib/growth.functions": { completeReferralForUser: async () => {} },
    "./match-save.server": { insertOwnedMatch },
    "@/lib/badminton-rules": rules,
    "@/lib/progress.server": { synchronizeProgressForMatch: async () => {} },
  });
  const supabase = {
    from(table) {
      assert.equal(table, "matches");
      return {
        insert(row) {
          inserted.push(row);
          return { select: () => ({ single: async () => ({ data: { id: "saved" } }) }) };
        },
      };
    },
  };
  return (data) => loaded.saveMatch({ data, context: { userId: owner, supabase } });
}

const scoreboardPayload = {
  mode: "singles",
  format: "21 · Best of 3",
  points_to_win: 21,
  best_of: 3,
  team_a_names: ["P1"],
  team_b_names: ["P2"],
  games: ANNOTATED,
  winner: "B",
  status: "finished",
};

test("the annotated match saves with p2 as the winner of both games", async () => {
  const inserted = [];
  const save = await saveWith(inserted);
  // The server function runs in its own realm, so compare plain data.
  const receipt = JSON.parse(JSON.stringify(await save(scoreboardPayload)));
  assert.deepEqual(receipt, { id: "saved", progressPending: false });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].winner, "B");
  assert.equal(inserted[0].games_won_a, 0);
  assert.equal(inserted[0].games_won_b, 2);
  assert.deepEqual(inserted[0].games, ANNOTATED);
});

test("online saves reject results the rules could not produce", async () => {
  const inserted = [];
  const save = await saveWith(inserted);
  for (const change of [
    { winner: "A" },
    { winner: null },
    { games: [...ANNOTATED, { a: 21, b: 0 }] },
    { games: [{ a: 21, b: 20 }], winner: "A" },
    { games: [{ a: 31, b: 29 }], winner: "A" },
    { games: [{ a: 21, b: 21 }], winner: null },
  ])
    await assert.rejects(save({ ...scoreboardPayload, ...change }), /Validation/);
  assert.equal(inserted.length, 0);
  // Unfinished matches are not results yet, so they are stored as sent.
  await save({
    ...scoreboardPayload,
    games: [{ a: 5, b: 3 }],
    winner: null,
    status: "in_progress",
  });
  assert.equal(inserted.length, 1);
});
