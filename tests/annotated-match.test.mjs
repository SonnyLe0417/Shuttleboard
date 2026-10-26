import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  annotatedLanding,
  classifyRallyEnding,
  loadMatchAnnotation,
  nearPlayerAt,
  parseAnnotationTime,
} from "../src/lib/match-annotation.ts";
import { formatGameScores, replayMatch } from "../src/lib/match-timeline.ts";
import { PRESETS } from "../src/lib/badminton-rules.ts";

const raw = JSON.parse(
  readFileSync(new URL("./fixtures/singles-match-1.json", import.meta.url), "utf8"),
);
const match = loadMatchAnnotation(raw);
const asListed = loadMatchAnnotation({ ...raw, unannotatedRallies: [] });
const SIDE_CHANGE = 14 * 60 + 22;

test("annotation times parse strictly", () => {
  assert.equal(parseAnnotationTime(9), 9);
  assert.equal(parseAnnotationTime("1:04"), 64);
  assert.equal(parseAnnotationTime("1:02:03"), 3723);
  assert.equal(parseAnnotationTime("N/A"), null);
  assert.equal(parseAnnotationTime(""), null);
  for (const bad of ["soon", "1:75", "-3", "1::2", -1, Number.NaN]) {
    assert.ok(Number.isNaN(parseAnnotationTime(bad)), String(bad));
  }
  assert.throws(() =>
    loadMatchAnnotation({ points: [{ fromSecond: "soon", toSecond: 3, winner: "p1" }] }),
  );
  assert.throws(() =>
    loadMatchAnnotation({ points: [{ fromSecond: 5, toSecond: 3, winner: "p1" }] }),
  );
  assert.throws(() =>
    loadMatchAnnotation({ points: [{ fromSecond: 1, toSecond: 3, winner: "p3" }] }),
  );
});

test("the student's list skips exactly one rally, between 22:54 and 23:06", () => {
  assert.equal(asListed.rallies.length, 71);
  assert.deepEqual(asListed.gaps, [{ afterIndex: 64, expectedStart: 1374, actualStart: 1386 }]);
  const unfinished = replayMatch(asListed.rallies);
  assert.equal(formatGameScores(unfinished.games), "18-21");
  assert.deepEqual(unfinished.score, { p1: 12, p2: 20 });
  assert.equal(unfinished.matchWinner, null);
});

test("with the deduced rally the annotation is continuous and complete", () => {
  assert.equal(match.rallies.length, 72);
  assert.deepEqual(match.gaps, []);
  const inferred = match.rallies.filter((rally) => rally.inferred);
  assert.equal(inferred.length, 1);
  assert.equal(inferred[0].index, 65);
  assert.equal(inferred[0].start, 1374);
  assert.equal(inferred[0].end, null);
  assert.equal(inferred[0].winner, "p2");
  for (const [i, rally] of match.rallies.entries()) {
    if (i === 0) continue;
    const previous = match.rallies[i - 1];
    assert.ok(rally.start > (previous.end ?? previous.start));
    assert.equal(previous.nextServe, rally.start);
  }
});

test("replaying the annotation gives p2 the match 2-0, 21-18 and 21-12", () => {
  const timeline = replayMatch(match.rallies, { rules: PRESETS[0], initialNear: "p1" });
  assert.equal(formatGameScores(timeline.games), "18-21, 12-21");
  assert.equal(timeline.matchWinner, "p2");
  assert.deepEqual(timeline.gamesWon, { p1: 0, p2: 2 });
  // The match is decided on the final rally, not before it.
  assert.equal(
    timeline.steps.findIndex((step) => step.afterMatch),
    -1,
  );
  assert.equal(timeline.steps.at(-1).gameOver, true);
  assert.equal(match.rallies.at(-1).note, "Match Over p2 wins");
});

test("game 1 ends on the 13:47 rally and the timeline changes ends at the annotated 14:22", () => {
  const timeline = replayMatch(match.rallies, { initialNear: match.initialNear });
  const gameEnds = timeline.steps.flatMap((step, index) => (step.gameOver ? [index] : []));
  assert.deepEqual(gameEnds, [38, 71]);
  assert.equal(match.rallies[38].start, 13 * 60 + 47);
  assert.equal(match.rallies[38].nextServe, SIDE_CHANGE);
  assert.deepEqual(match.sideChanges, [{ at: SIDE_CHANGE, near: "p2" }]);
  assert.equal(match.initialNear, "p1");
  for (const [index, step] of timeline.steps.entries()) {
    assert.equal(step.near, nearPlayerAt(match, match.rallies[index].start), `rally ${index}`);
  }
  const changes = timeline.steps.flatMap((step, index) => (step.changedEnds ? [index] : []));
  assert.deepEqual(changes, [38]);
});

test("the winner of each rally serves the next one, and game 2 opens with p2 serving", () => {
  const timeline = replayMatch(match.rallies);
  assert.equal(timeline.server, "p2");
  const opening = replayMatch(match.rallies.slice(0, 39));
  assert.equal(opening.server, "p2");
  assert.deepEqual(opening.score, { p1: 0, p2: 0 });
  // The deduced rally was served by p1, who won the 22:32 rally, at 10-16.
  const beforeDeduced = replayMatch(match.rallies.slice(0, 65));
  assert.equal(beforeDeduced.server, "p1");
  assert.deepEqual(beforeDeduced.score, { p1: 10, p2: 16 });
});

test("how each rally ended is categorised, and a named player is always the loser", () => {
  assert.equal(classifyRallyEnding("in"), "in");
  assert.equal(classifyRallyEnding("out"), "out");
  assert.equal(classifyRallyEnding("p1 hit it out"), "out");
  assert.equal(classifyRallyEnding("out, p2 smashed it into the net"), "net");
  assert.equal(classifyRallyEnding("p1 hit but didn't go over the net"), "net");
  assert.equal(classifyRallyEnding("p1 missed the shuttle"), "missed");
  const listed = match.rallies.filter((rally) => !rally.inferred);
  const counts = {};
  for (const rally of listed) counts[rally.ending] = (counts[rally.ending] ?? 0) + 1;
  assert.deepEqual(counts, { out: 25, in: 26, net: 19, missed: 1 });
  for (const point of raw.points) {
    const named = /\b(p[12])\b/.exec(point.how)?.[1];
    if (named) assert.notEqual(named, point.winner, point.how);
  }
});

test("eight landings were not visible to the annotator", () => {
  const unseen = match.rallies.filter((rally) => !rally.landingVisible && !rally.inferred);
  assert.deepEqual(
    unseen.map((rally) => rally.index),
    [20, 22, 28, 31, 33, 34, 62, 69],
  );
});

test("expected landing ends follow from the winner, the ending and the ends in play", () => {
  // Game 1: p1 near. An out by p2 lands beyond p1's lines at the near end.
  assert.deepEqual(annotatedLanding({ winner: "p1", ending: "out" }, "p1"), {
    end: "near",
    inCourt: false,
  });
  // p2 netting the shuttle leaves it on p2's own (far) side.
  assert.deepEqual(annotatedLanding({ winner: "p1", ending: "net" }, "p1"), {
    end: "far",
    inCourt: true,
  });
  // Game 2: p2 near. A winner in court for p2 lands at p1's far end.
  assert.deepEqual(annotatedLanding({ winner: "p2", ending: "in" }, "p2"), {
    end: "far",
    inCourt: true,
  });
});

test("the description conflicts are pinned so new ones are noticed", () => {
  const conflicts = raw.points.flatMap((point, index) => {
    const text = (point.description ?? "").toLowerCase();
    const describedFault = /\b(p[12]) (?:hit|cleared|lifted) (?:it )?out\b/.exec(text)?.[1];
    return describedFault === point.winner ? [index] : [];
  });
  assert.deepEqual(conflicts, [33, 54]);
  assert.equal(raw.reviewNotes.length, 3);
});
