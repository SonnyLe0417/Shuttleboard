import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { evaluateAgainstAnnotation } from "../src/lib/annotation-evaluation.ts";
import { loadMatchAnnotation } from "../src/lib/match-annotation.ts";
import { IMAGE_CORNERS, traceFromAnnotation } from "./fixtures/annotation-trace.mjs";

const fixture = new URL("./fixtures/singles-match-1.json", import.meta.url);
const annotation = loadMatchAnnotation(JSON.parse(readFileSync(fixture, "utf8")));
const trace = traceFromAnnotation(annotation);

test("the pipeline matches every annotated rally of the simulated match", () => {
  const { summary, games } = evaluateAgainstAnnotation(annotation, trace.points, trace.homography);
  // Rallies end when the shuttle settles, within a second of the annotated end.
  assert.ok(summary.largestTiming < 1, `${summary.largestTiming}`);
  assert.deepEqual(
    { ...summary, recall: undefined, winnerAccuracy: undefined, largestTiming: undefined },
    {
      annotated: 72,
      found: 72,
      missed: 0,
      extra: 0,
      winnersRight: 72,
      winnersWrong: 0,
      countedWrong: 0,
      pending: 9,
      recall: undefined,
      winnerAccuracy: undefined,
      largestTiming: undefined,
    },
  );
  assert.deepEqual(games, {
    annotated: "18-21, 12-21",
    app: "18-21, 12-21",
    appWinner: "p2",
    match: true,
  });
});

test("missed and extra rally endings are reported, not hidden", () => {
  const nothing = evaluateAgainstAnnotation(annotation, [], trace.homography);
  assert.equal(nothing.summary.missed, 72);
  assert.equal(nothing.summary.recall, 0);

  // A shuttle knocked across the court 6 s after the first rally ends, coming
  // to rest in the far court: a second ending inside the first rally's window.
  const extra = [];
  for (let frame = 0; frame < 45; frame++) {
    const time = 26 + frame / 30;
    const flying = frame < 15;
    extra.push({
      frame: 99_000 + frame,
      time,
      x: 0.5,
      y: flying ? 0.8 - frame * 0.03 : 0.38,
      confidence: 0.9,
      visible: true,
      detected: true,
      repaired: false,
    });
  }
  const points = [
    ...trace.points.filter((point) => point.time < 26 || point.time >= 27.5),
    ...extra,
  ];
  const report = evaluateAgainstAnnotation(annotation, points, trace.homography);
  assert.ok(report.summary.extra >= 1);
  assert.equal(report.rallies[0].found.length, 2);
});

test("the command reports the simulated match and gates on thresholds", () => {
  const run = (...flags) =>
    execFileSync(
      process.execPath,
      [
        "--import",
        "./scripts/register-typescript.mjs",
        "scripts/evaluate-annotated-match.mjs",
        "--annotation",
        "tests/fixtures/singles-match-1.json",
        "--simulate",
        ...flags,
      ],
      { encoding: "utf8" },
    );
  const output = run("--min-recall", "0.95", "--min-winner-accuracy", "0.95");
  assert.match(output, /Found\s+72 \(100%\)/);
  assert.match(output, /Games \(app\)\s+18-21, 12-21, p2 wins/);
  assert.match(run("--marked-ends"), /Winner right\s+72/);
});

test("wrong winners, phantom rallies and the annotated starting ends are all caught", () => {
  // Reading the match with the ends swapped hands most rallies to the wrong player.
  const swapped = evaluateAgainstAnnotation(annotation, trace.points, trace.homography, {
    initialNear: "p2",
  });
  assert.ok(swapped.summary.winnersWrong > 36);
  assert.ok(swapped.summary.countedWrong > 0);
  assert.ok(swapped.summary.winnerAccuracy < 0.5);
  assert.equal(swapped.games.match, false);

  // A knock-up before the first serve lands outside every annotated rally.
  const warmUp = [];
  for (let frame = 0; frame < 60; frame++) {
    const time = 2 + frame / 30;
    warmUp.push({
      frame: 90_000 + frame,
      time,
      x: 0.5,
      y: frame < 15 ? 0.8 - frame * 0.03 : 0.38,
      confidence: 0.9,
      visible: true,
      detected: true,
      repaired: false,
    });
  }
  const points = [...warmUp, ...trace.points.filter((point) => point.time >= 4)];
  const early = evaluateAgainstAnnotation(annotation, points, trace.homography);
  assert.equal(early.summary.extra, 1);
  assert.equal(early.summary.found, 72);

  // An annotation where player 1 starts at the far end is read with those ends.
  const raw = JSON.parse(readFileSync(fixture, "utf8"));
  const mirrored = loadMatchAnnotation({
    ...raw,
    player1: raw.player2,
    player2: raw.player1,
    sideChanges: raw.sideChanges.map((change) => ({
      ...change,
      player1: change.player2,
      player2: change.player1,
    })),
  });
  assert.equal(mirrored.initialNear, "p2");
  const mirroredTrace = traceFromAnnotation(mirrored);
  const report = evaluateAgainstAnnotation(
    mirrored,
    mirroredTrace.points,
    mirroredTrace.homography,
  );
  assert.equal(report.summary.winnersRight, 72);
  assert.equal(report.games.match, true);
});

test("the command fails a run with an extra rally ending", () => {
  const dir = mkdtempSync(join(tmpdir(), "shuttleboard-eval-"));
  try {
    const extra = [];
    for (let frame = 0; frame < 45; frame++) {
      extra.push({
        frame: 99_000 + frame,
        time: 26 + frame / 30,
        x: 0.5,
        y: frame < 15 ? 0.8 - frame * 0.03 : 0.38,
        confidence: 0.9,
        visible: true,
        detected: true,
        repaired: false,
      });
    }
    const points = [
      ...trace.points.filter((point) => point.time < 26 || point.time >= 27.5),
      ...extra,
    ];
    writeFileSync(join(dir, "result.json"), JSON.stringify({ coordinates: points }));
    writeFileSync(join(dir, "corners.json"), JSON.stringify(IMAGE_CORNERS));
    const run = () =>
      execFileSync(
        process.execPath,
        [
          "--import",
          "./scripts/register-typescript.mjs",
          "scripts/evaluate-annotated-match.mjs",
          "--annotation",
          "tests/fixtures/singles-match-1.json",
          "--coordinates",
          join(dir, "result.json"),
          "--corners",
          join(dir, "corners.json"),
          "--min-recall",
          "0.9",
        ],
        { encoding: "utf8", stdio: "pipe" },
      );
    assert.throws(run, (error) => error.status === 1 && /max-extra/.test(error.stderr));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
