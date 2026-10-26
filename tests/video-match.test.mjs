import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadMatchAnnotation } from "../src/lib/match-annotation.ts";
import { buildTrackNetRallies } from "../src/lib/tracknet-rallies.ts";
import { formatGameScores } from "../src/lib/match-timeline.ts";
import {
  parseSideChanges,
  resolveVideoMatch,
  videoMatchOptions,
  DEFAULT_VIDEO_MATCH_SETTINGS,
} from "../src/lib/video-match.ts";
import { correctRally, excludeRally, setRallyReviewStatus } from "../src/lib/analysis-results.ts";
import { traceFromAnnotation } from "./fixtures/annotation-trace.mjs";

const annotation = loadMatchAnnotation(
  JSON.parse(readFileSync(new URL("./fixtures/singles-match-1.json", import.meta.url), "utf8")),
);
const trace = traceFromAnnotation(annotation);
const built = buildTrackNetRallies(trace.points, trace.homography);

/** The proposals that fall inside each annotated rally, from its serve to the next serve. */
function byAnnotatedRally(rallies) {
  return annotation.rallies.map((rally) =>
    rallies.filter((found) => found.t >= rally.start && found.t < (rally.nextServe ?? Infinity)),
  );
}

test("the annotated match is found as one rally ending per annotated rally", () => {
  assert.equal(trace.points.length > 45_000, true);
  assert.equal(built.length, annotation.rallies.length);
  for (const [index, found] of byAnnotatedRally(built).entries()) {
    assert.equal(found.length, 1, `rally ${index} at ${annotation.rallies[index].start}s`);
  }
});

test("the video scores the annotated match as p2 winning 21-18, 21-12", () => {
  const match = resolveVideoMatch(built);
  assert.equal(formatGameScores(match.timeline.games), "18-21, 12-21");
  assert.equal(match.timeline.matchWinner, "p2");
  assert.deepEqual(match.timeline.gamesWon, { p1: 0, p2: 2 });
  for (const [index, [found]] of byAnnotatedRally(match.rallies).entries()) {
    assert.equal(found.winner, annotation.rallies[index].winner, `rally ${index}`);
  }
});

test("only the rallies the camera never saw wait for review", () => {
  const match = resolveVideoMatch(built);
  const unseen = annotation.rallies.filter((rally) => !rally.landingVisible);
  const pending = byAnnotatedRally(match.rallies).flatMap((found, index) =>
    found[0].countsTowardScore ? [] : [index],
  );
  assert.deepEqual(
    pending,
    unseen.map((rally) => rally.index),
  );
  assert.equal(match.pending, unseen.length);
  // Each one carries the right suggestion, read from who served next.
  for (const index of pending) {
    const [found] = byAnnotatedRally(match.rallies)[index];
    assert.equal(found.decidedBy, "next serve");
    assert.match(found.reviewReasons.join(" "), /not seen/);
  }
  // The confirmed tallies leave those points out, game by game: three of each
  // player's in game 1, and three of p2's in game 2 (22:02, 22:54 and 24:25).
  assert.deepEqual(match.confirmed, [
    { p1: 15, p2: 18 },
    { p1: 12, p2: 18 },
  ]);
});

test("confirming the suggestions completes the confirmed score", () => {
  let rallies = built;
  let match = resolveVideoMatch(rallies);
  for (const rally of match.rallies.filter((item) => !item.countsTowardScore)) {
    rallies = setRallyReviewStatus(rallies, rally.id, "confirmed", rally);
    match = resolveVideoMatch(rallies);
  }
  assert.equal(match.pending, 0);
  assert.deepEqual(match.confirmed, [
    { p1: 18, p2: 21 },
    { p1: 12, p2: 21 },
  ]);
});

test("players are matched to ends across the change of ends after game 1", () => {
  const match = resolveVideoMatch(built);
  const changeAfter = match.timeline.steps.findIndex((step) => step.changedEnds);
  assert.equal(match.rallies[changeAfter].t < annotation.sideChanges[0].at, true);
  assert.equal(match.rallies[changeAfter + 1].t >= annotation.sideChanges[0].at, true);
  // The same court position wins for different players before and after.
  const nearIn = byAnnotatedRally(match.rallies)
    .map(([found]) => found)
    .filter((found) => found.landingEnd === "near" && found.inBounds);
  assert.ok(nearIn.some((found) => found.game === 1 && found.winner === "p2"));
  assert.ok(nearIn.some((found) => found.game === 2 && found.winner === "p1"));
});

test("marked changes of ends take precedence over the score", () => {
  const marked = parseSideChanges("14:22", "p1");
  assert.deepEqual(marked, [{ at: 862, near: "p2" }]);
  const options = videoMatchOptions({ ...DEFAULT_VIDEO_MATCH_SETTINGS, sideChanges: marked });
  assert.equal(formatGameScores(resolveVideoMatch(built, options).timeline.games), "18-21, 12-21");
  // A wrong mark moves every rally between it and the real change to the other player.
  const wrong = videoMatchOptions({
    ...DEFAULT_VIDEO_MATCH_SETTINGS,
    sideChanges: parseSideChanges("5:00", "p1"),
  });
  assert.notEqual(formatGameScores(resolveVideoMatch(built, wrong).timeline.games), "18-21, 12-21");
  assert.equal(parseSideChanges("soon", "p1"), null);
  assert.deepEqual(parseSideChanges("", "p1"), []);
});

test("a correction re-scores every rally after it", () => {
  const match = resolveVideoMatch(built);
  // Hand p1 the last rally of game 1: game 1 then goes on past 18-20 ... 19-20.
  const lastOfGame1 = match.rallies[match.timeline.steps.findIndex((step) => step.gameOver)];
  const corrected = resolveVideoMatch(correctRally(built, lastOfGame1.id, { winner: "p1" }));
  assert.notEqual(formatGameScores(corrected.timeline.games), "18-21, 12-21");
  assert.equal(corrected.rallies.find((rally) => rally.id === lastOfGame1.id).winner, "p1");
});

test("rallies after the match ends do not score", () => {
  const match = resolveVideoMatch([
    ...built,
    { ...built.at(-1), id: 999, t: built.at(-1).t + 30, reviewerWinnerEnd: "far" },
  ]);
  const extra = match.rallies.find((rally) => rally.id === 999);
  assert.equal(extra.afterMatch, true);
  assert.equal(extra.countsTowardScore, false);
  assert.equal(match.timeline.matchWinner, "p2");
});

const landed = (id, t, end, inBounds, extra = {}) => ({
  id,
  t,
  landingImgX: 0.5,
  landingImgY: 0.5,
  landingCourtX: 0.5,
  landingCourtY: end === "near" ? 0.8 : 0.2,
  inBounds,
  winner: "p1",
  landingEnd: end,
  landingSeen: true,
  aiConfidence: 0.9,
  aiNote: "",
  countsTowardScore: true,
  ...extra,
});

test("a landing that the next serve contradicts goes to review", () => {
  // In court at the near end: p1 (near) lost. But p1 served the next rally.
  const match = resolveVideoMatch([
    landed(1, 10, "near", true),
    landed(2, 30, "far", true, { startT: 20, serveEnd: "near" }),
  ]);
  assert.equal(match.rallies[0].winner, "p2");
  assert.equal(match.rallies[0].countsTowardScore, false);
  assert.match(match.rallies[0].reviewReasons.join(" "), /Player 1 served next/);
});

test("a line call the next serve agrees with is settled", () => {
  const match = resolveVideoMatch([
    landed(1, 10, "near", false, {
      countsTowardScore: false,
      needsReview: true,
      landingAmbiguous: true,
      reviewReasons: ["The landing is on or near a boundary line."],
    }),
    landed(2, 30, "far", true, { startT: 20, serveEnd: "near" }),
  ]);
  // Out at the near end: p1 (near) wins, and p1 served next.
  assert.equal(match.rallies[0].winner, "p1");
  assert.equal(match.rallies[0].countsTowardScore, true);
  assert.equal(match.rallies[0].decidedBy, "landing and next serve");
});

test("at a game point the next serve cannot tell who won", () => {
  // 20-18 to p2 in game 1. p2 winning ends the game and changes ends, so the
  // next serve comes from p1's old end either way.
  const rallies = [];
  let t = 0;
  const point = (winner) => {
    // p1 is near in game 1: an in-court landing at the loser's end.
    const end = winner === "p2" ? "near" : "far";
    rallies.push(landed(rallies.length + 1, (t += 10), end, true));
  };
  for (let i = 0; i < 18; i++) point("p1");
  for (let i = 0; i < 20; i++) point("p2");
  rallies.push({
    ...landed(rallies.length + 1, (t += 10), "near", true),
    landingSeen: false,
    landingEnd: undefined,
    countsTowardScore: false,
  });
  rallies.push(
    landed(rallies.length + 1, (t += 10), "far", true, { startT: t - 5, serveEnd: "near" }),
  );
  const match = resolveVideoMatch(rallies);
  const unseen = match.rallies.at(-2);
  assert.equal(unseen.decidedBy, undefined);
  assert.equal(unseen.countsTowardScore, false);
});

test("reviewer decisions follow the ends when the start of the match is corrected", () => {
  // The reviewer first works with the wrong starting ends and confirms every suggestion.
  const wrong = { initialNear: "p2" };
  let rallies = built;
  for (const rally of resolveVideoMatch(rallies, wrong).rallies.filter((r) => !r.countsTowardScore))
    rallies = setRallyReviewStatus(rallies, rally.id, "confirmed", rally);
  // Fixing the setting re-attributes the confirmed rallies with everything else.
  const fixed = resolveVideoMatch(rallies);
  assert.equal(formatGameScores(fixed.timeline.games), "18-21, 12-21");
  for (const [index, [found]] of byAnnotatedRally(fixed.rallies).entries())
    assert.equal(found.winner, annotation.rallies[index].winner, `rally ${index}`);
  assert.equal(fixed.pending, 0);
});

test("keeping a pending rally for review changes nothing else", () => {
  const before = resolveVideoMatch(built);
  const pendingRally = before.rallies.find((rally) => !rally.countsTowardScore);
  const after = resolveVideoMatch(
    setRallyReviewStatus(built, pendingRally.id, "needs-review", pendingRally),
  );
  assert.equal(formatGameScores(after.timeline.games), formatGameScores(before.timeline.games));
  assert.deepEqual(
    after.rallies.map((rally) => [rally.winner, rally.countsTowardScore]),
    before.rallies.map((rally) => [rally.winner, rally.countsTowardScore]),
  );
  // Keeping a counted rally for review takes it out of the score but not out of the games.
  const counted = before.rallies.find((rally) => rally.countsTowardScore);
  const kept = resolveVideoMatch(setRallyReviewStatus(built, counted.id, "needs-review", counted));
  assert.equal(formatGameScores(kept.timeline.games), "18-21, 12-21");
  assert.equal(kept.pending, before.pending + 1);
});

test("correcting a rally the next serve settled keeps it in the score", () => {
  const match = resolveVideoMatch(built);
  const settled = match.rallies.find(
    (rally) => rally.landingAmbiguous && rally.countsTowardScore && !rally.reviewStatus,
  );
  assert.ok(settled, "the simulated match has a settled line or net call");
  const reaffirmed = resolveVideoMatch(
    correctRally(built, settled.id, { winner: settled.winner }, settled),
  );
  assert.equal(reaffirmed.pending, match.pending);
  const flipped = settled.winner === "p1" ? "p2" : "p1";
  const corrected = resolveVideoMatch(
    correctRally(built, settled.id, { winner: flipped }, settled),
  );
  const after = corrected.rallies.find((rally) => rally.id === settled.id);
  assert.equal(after.winner, flipped);
  assert.equal(after.countsTowardScore, true);
});

test("a rally marked as not a rally drops out, and the real next serve is read", () => {
  // A lands in court at the near end, so p2 wins and serves next from the far end.
  // X is a knock-up the detector took for a rally; B is the real next rally.
  const rallies = [
    landed(1, 10, "near", true),
    landed(2, 20, "far", true, { startT: 15, serveEnd: "near" }),
    landed(3, 40, "far", true, { startT: 30, serveEnd: "far" }),
  ];
  const withKnockUp = resolveVideoMatch(rallies);
  assert.equal(withKnockUp.rallies[0].countsTowardScore, false);
  const excluded = resolveVideoMatch(excludeRally(rallies, 2, true));
  assert.equal(excluded.rallies[0].countsTowardScore, true);
  assert.equal(excluded.rallies[0].decidedBy, "landing and next serve");
  assert.equal(excluded.rallies[1].excluded, true);
  assert.equal(excluded.rallies[1].game, undefined);
  assert.deepEqual(excluded.confirmed, [{ p1: 1, p2: 1 }]);
});

test("the reviewer's in/out call stands over the next serve", () => {
  const match = resolveVideoMatch(built);
  const out = match.rallies.find(
    (rally) => rally.landingSeen && !rally.inBounds && rally.countsTowardScore,
  );
  const marked = resolveVideoMatch(correctRally(built, out.id, { inBounds: true }, out));
  const after = marked.rallies.find((rally) => rally.id === out.id);
  assert.notEqual(after.winner, out.winner);
  assert.equal(after.countsTowardScore, true);
  assert.equal(after.decidedBy, "reviewer");
});

test("the near end honours marked changes of ends, and vision verdicts follow it", () => {
  const rallies = [
    landed(1, 10, "near", true),
    landed(2, 70, "near", true, { aiWinnerEnd: "far" }),
  ];
  const plain = resolveVideoMatch(rallies);
  assert.equal(plain.near, "p1");
  const marked = resolveVideoMatch(rallies, { sideChanges: parseSideChanges("1:00", "p1") });
  assert.equal(marked.near, "p2");
  // After the marked change p2 is near, so the far end (and the vision verdict) is p1.
  assert.equal(marked.rallies[1].winner, "p1");
  assert.equal(marked.rallies[1].decidedBy, "vision check");
  assert.equal(plain.rallies[1].winner, "p2");
});

test("the simulated match scores the same at 60 frames a second", () => {
  const fast = traceFromAnnotation(annotation, { fps: 60 });
  const match = resolveVideoMatch(buildTrackNetRallies(fast.points, fast.homography));
  assert.equal(match.rallies.length, 72);
  assert.equal(formatGameScores(match.timeline.games), "18-21, 12-21");
  for (const [index, [found]] of byAnnotatedRally(match.rallies).entries())
    assert.equal(found.winner, annotation.rallies[index].winner, `rally ${index}`);
});
