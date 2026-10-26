import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createMatchController,
  doublesServe,
  initialState,
  reduceMatch,
  totalMatchPoints,
} from "../src/lib/match-controller.ts";
import { completedOfflineMatch, restoreLegacyOfflineDraft } from "../src/lib/offline-result.ts";
import { correctServeSide } from "../src/lib/badminton.ts";
import { loadMatchAnnotation, nearPlayerAt } from "../src/lib/match-annotation.ts";

const annotation = loadMatchAnnotation(
  JSON.parse(readFileSync(new URL("./fixtures/singles-match-1.json", import.meta.url), "utf8")),
);
const team = (player) => (player === "p1" ? 0 : 1);
const ms = (seconds) => 1_000_000 + seconds * 1000;
const point = (t, at) => ({ type: "point", team: t, reason: "won the rally", at });

function scoreAnnotatedMatch(onServe = () => {}) {
  let c = createMatchController();
  for (const rally of annotation.rallies) {
    c = reduceMatch(c, { type: "rally", at: ms(rally.start) });
    onServe(c.match, rally);
    c = reduceMatch(c, point(team(rally.winner), ms(rally.end ?? rally.start + 5)));
  }
  return c;
}

test("the scoreboard scores the annotated match 18-21, 12-21 for p2", () => {
  const { match } = scoreAnnotatedMatch();
  assert.deepEqual(match.completedGames, [
    { a: 18, b: 21 },
    { a: 12, b: 21 },
  ]);
  assert.equal(match.matchOver, true);
  assert.equal(match.matchWinnerTeam, 1);
  assert.equal(totalMatchPoints(match), 72);
  // The match starts with the first serve at 0:09, not when the first point is awarded.
  assert.equal(match.matchStartedAt, ms(9));
  const saved = completedOfflineMatch("owner", "id", match).payload;
  assert.equal(saved.total_rallies, 72);
  assert.equal(saved.winner, "B");
});

test("ends, serving end and serving court follow every rally of the annotated match", () => {
  let checked = 0;
  scoreAnnotatedMatch((match, rally) => {
    if (rally.index === 0) return;
    const near = team(nearPlayerAt(annotation, rally.start));
    assert.equal(match.nearTeam, near, `ends before rally ${rally.index}`);
    // The winner of the previous rally serves; nearSide says if they are at the near end.
    assert.equal(match.server, team(annotation.rallies[rally.index - 1].winner));
    assert.equal(match.nearSide, match.server === near);
    assert.equal(match.declaredSide, correctServeSide(match.score[match.server]));
    checked++;
  });
  assert.equal(checked, 71);
});

test("the log announces the intervals at 11 and the change of ends", () => {
  const { match } = scoreAnnotatedMatch();
  const info = match.log.filter((row) => row.kind === "info").map((row) => row.text);
  assert.deepEqual(info.reverse(), [
    "Interval at 11.",
    "Change ends for game 2. Team B serves first.",
    "Interval at 11.",
  ]);
});

test("players change ends at 11 in the deciding game, and undo changes them back", () => {
  let c = createMatchController();
  let at = 1;
  const score = (t, n) => {
    for (let i = 0; i < n; i++) c = reduceMatch(c, point(t, at++));
  };
  score(0, 21);
  assert.equal(c.match.nearTeam, 1);
  score(1, 21);
  assert.equal(c.match.nearTeam, 0);
  score(0, 10);
  score(1, 10);
  assert.equal(c.match.nearTeam, 0);
  score(1, 1);
  assert.equal(c.match.nearTeam, 1);
  assert.equal(c.match.nearSide, true);
  assert.match(c.match.log[0].text, /Change ends for the rest of the deciding game/);
  c = reduceMatch(c, { type: "undo" });
  assert.equal(c.match.nearTeam, 0);
  score(1, 1);
  score(1, 2);
  // Only the first time a side reaches 11 changes ends.
  assert.equal(c.match.nearTeam, 1);
});

test("the serve check follows the serve to the far end", () => {
  let c = createMatchController();
  c = reduceMatch(c, { type: "serveCheck", value: true });
  c = reduceMatch(c, point(1, 1));
  // Team B serves from the far end at 0-1, so from their left court to the near
  // receiver's left court, which is the left of the picture.
  assert.equal(c.match.nearSide, false);
  c = reduceMatch(c, { type: "landing", x: 0.3, y: 0.8, at: 2 });
  assert.match(c.match.log[0].text, /^In at/);
  c = reduceMatch(c, { type: "landing", x: 0.7, y: 0.8, at: 3 });
  assert.match(c.match.log[0].text, /^Out at/);
  c = reduceMatch(c, point(1, 4));
  // The landing mark belongs to the rally that just ended.
  assert.equal(c.match.landing, null);
  // Ticking "server near" off swaps ends: Team B is now at the near end.
  c = reduceMatch(c, { type: "nearSide", value: true });
  assert.equal(c.match.nearTeam, 1);
});

test("the first server can be chosen until the match starts", () => {
  let c = createMatchController();
  c = reduceMatch(c, { type: "firstServer", team: 1 });
  assert.equal(c.match.server, 1);
  assert.equal(c.match.nearSide, false);
  c = reduceMatch(c, { type: "undo" });
  assert.equal(c.match.server, 0);
  c = reduceMatch(c, { type: "rally", at: 5 });
  const started = reduceMatch(c, { type: "firstServer", team: 1 });
  assert.equal(started, c);
});

test("doubles partners swap courts only after winning a rally they served", () => {
  let c = createMatchController();
  c = reduceMatch(c, { type: "mode", value: "doubles" });
  const serve = () => {
    const { server, receiver, side } = doublesServe(c.match);
    return `${server}>${receiver} ${side}`;
  };
  const sequence = [serve()];
  for (const [winner, at] of [
    [0, 1],
    [1, 2],
    [0, 3],
    [0, 4],
    [1, 5],
  ]) {
    c = reduceMatch(c, point(winner, at));
    sequence.push(serve());
  }
  assert.deepEqual(sequence, [
    "A1>B1 right", // 0-0
    "A1>B2 left", // 1-0: A won its serve, so A1 and A2 swap and A1 serves again
    "B2>A1 left", // 1-1: the serve passes without anyone moving
    "A2>B1 right", // 2-1: A regains it; A2 stands in A's right court
    "A2>B2 left", // 3-1: A won its serve, so the partners swap again
    "B1>A1 right", // 3-2: B regains it from its right court
  ]);
});

test("a new match from a preset starts clean, and the rally timer stops after the match", () => {
  let c = createMatchController();
  c = reduceMatch(c, { type: "preset", id: "golden", at: 0 });
  for (let i = 1; i <= 21; i++) c = reduceMatch(c, point(1, i));
  assert.equal(c.match.matchOver, true);
  assert.equal(reduceMatch(c, { type: "rally", at: 99 }), c);
  c = reduceMatch(c, { type: "preset", id: "21", at: 100 });
  assert.equal(c.match.server, 0);
  assert.equal(c.match.nearTeam, 0);
  assert.equal(c.match.celebrateKind, null);
  assert.deepEqual(
    c.match.log.map((row) => row.text),
    ["New match — 21 · Best of 3."],
  );
});

test("drafts saved before the ends model restore with Team A at the near end", () => {
  const legacy = { ...initialState({ id: "21" }) };
  delete legacy.nearTeam;
  delete legacy.rightCourt;
  const restored = restoreLegacyOfflineDraft(
    JSON.stringify({ ...legacy, preset: { id: "21" }, matchStartedAt: null }),
  );
  assert.equal(restored.nearTeam, 0);
  assert.deepEqual(restored.rightCourt, [0, 0]);
});
