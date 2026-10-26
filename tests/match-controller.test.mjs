import test from "node:test";
import assert from "node:assert/strict";
import { createMatchController, reduceMatch } from "../src/lib/match-controller.ts";
const point = (team = 0, at = 100) => ({ type: "point", team, at });
test("two commands in the same event retain both points and undo sequentially", () => {
  const initial = createMatchController();
  const one = reduceMatch(initial, point());
  const two = reduceMatch(one, point());
  assert.deepEqual(two.match.score, [2, 0]);
  assert.deepEqual(initial.match.score, [0, 0]);
  assert.deepEqual(reduceMatch(two, { type: "undo" }).match.score, [1, 0]);
  assert.deepEqual(
    reduceMatch(reduceMatch(two, { type: "undo" }), { type: "undo" }).match.score,
    [0, 0],
  );
  assert.equal(two.match.log[0].at, 100);
  assert.deepEqual(
    two.effects.map((e) => e.sequence),
    [1, 2],
  );
  assert.equal(reduceMatch(two, { type: "ack", sequence: 1 }).effects.length, 1);
  assert.deepEqual(reduceMatch(initial, point()), one, "reducer is deterministic");
});
test("batched points cross a game boundary and faults award the other team", () => {
  let c = createMatchController();
  for (let n = 0; n < 22; n++) c = reduceMatch(c, point(0, n + 1));
  assert.deepEqual(c.match.games, [1, 0]);
  assert.deepEqual(c.match.score, [1, 0]);
  assert.deepEqual(c.match.completedGames, [{ a: 21, b: 0 }]);
  c = reduceMatch(c, { type: "fault", team: 0, fault: "service fault", at: 40 });
  assert.deepEqual(c.match.score, [1, 1]);
  assert.deepEqual(
    c.effects.slice(-2).map((e) => e.kind),
    ["fault", "point"],
  );
});
test("history stays bounded and reset, presets and restoration use the same controller", () => {
  let c = createMatchController();
  for (let n = 0; n < 75; n++)
    c = reduceMatch(c, { type: "side", value: n % 2 ? "left" : "right" });
  assert.equal(c.history.length, 60);
  c = reduceMatch(c, point());
  const draft = c.match;
  c = reduceMatch(c, { type: "reset" });
  assert.deepEqual(c.match.score, [0, 0]);
  c = reduceMatch(c, { type: "undo" });
  assert.deepEqual(c.match.score, [1, 0]);
  c = reduceMatch(c, { type: "preset", id: "11", at: 88 });
  assert.equal(c.match.preset.id, "11");
  assert.equal(c.match.log[0].at, 88);
  c = reduceMatch(c, { type: "restore", match: draft });
  assert.deepEqual(c.match, draft);
  assert.equal(c.history.length, 0);
  assert.equal(c.effects.length, 0);
});
