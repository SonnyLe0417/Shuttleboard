import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { evaluateAgainstAnnotation } from "../src/lib/annotation-evaluation.ts";
import { loadMatchAnnotation } from "../src/lib/match-annotation.ts";
import { traceFromAnnotation } from "./fixtures/annotation-trace.mjs";

const fixture = new URL("./fixtures/singles-match-1.json", import.meta.url);
const annotation = loadMatchAnnotation(JSON.parse(readFileSync(fixture, "utf8")));
const trace = traceFromAnnotation(annotation);

test("the pipeline matches every annotated rally of the simulated match", () => {
  const { summary, games } = evaluateAgainstAnnotation(annotation, trace.points, trace.homography);
  assert.deepEqual(
    { ...summary, recall: undefined, winnerAccuracy: undefined },
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
    },
  );
  assert.deepEqual(games, { annotated: "18-21, 12-21", app: "18-21, 12-21", appWinner: "p2" });
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
