// Scores the uploaded-video pipeline against a hand-labelled match.
//
//   node --import ./scripts/register-typescript.mjs scripts/evaluate-annotated-match.mjs \
//     --annotation tests/fixtures/singles-match-1.json \
//     --coordinates path/to/tracknet-result.json \
//     --corners path/to/court-calibration.json
//
// --coordinates takes a TrackNet job result ({ coordinates: [...] }) or a bare
// array of rows. --corners takes the calibration the video page saves
// (localStorage "shuttleboard.tracknet-court": { corners, homography }) or a
// bare array of the four normalized corners, near-left, near-right,
// far-right, far-left. Use --simulate instead of both to run on a trace
// generated from the annotation itself.
//
// Options: --mode singles|doubles, --preset 21|15|11|golden, --marked-ends
// (use the annotation's side changes instead of following the score),
// --offset <seconds> (added to coordinate times, for a trimmed clip),
// --report <file> (write the full JSON), --min-recall and
// --min-winner-accuracy (exit 1 below them).
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { evaluateAgainstAnnotation } from "../src/lib/annotation-evaluation.ts";
import { computeHomography } from "../src/lib/birdie-tracker.ts";
import { findPreset } from "../src/lib/badminton-rules.ts";
import { courtDestinationCorners } from "../src/lib/court-calibration.ts";
import { loadMatchAnnotation } from "../src/lib/match-annotation.ts";
import { formatAnalysisTime } from "../src/lib/analysis-results.ts";

const { values } = parseArgs({
  options: {
    annotation: { type: "string" },
    coordinates: { type: "string" },
    corners: { type: "string" },
    simulate: { type: "boolean", default: false },
    mode: { type: "string", default: "singles" },
    preset: { type: "string", default: "21" },
    "marked-ends": { type: "boolean", default: false },
    offset: { type: "string", default: "0" },
    report: { type: "string" },
    "min-recall": { type: "string" },
    "min-winner-accuracy": { type: "string" },
  },
});

const fail = (message) => {
  console.error(message);
  process.exit(2);
};
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

if (!values.annotation) fail("--annotation is required.");
if (!["singles", "doubles"].includes(values.mode)) fail("--mode must be singles or doubles.");
const annotation = loadMatchAnnotation(readJson(values.annotation));

let points;
let homography;
if (values.simulate) {
  const { traceFromAnnotation } = await import("../tests/fixtures/annotation-trace.mjs");
  ({ points, homography } = traceFromAnnotation(annotation));
} else {
  if (!values.coordinates || !values.corners) {
    fail("Give --coordinates and --corners, or --simulate.");
  }
  const result = readJson(values.coordinates);
  points = Array.isArray(result) ? result : result.coordinates;
  if (!Array.isArray(points)) fail("No coordinate rows found in --coordinates.");
  const offset = Number(values.offset);
  if (!Number.isFinite(offset)) fail("--offset must be a number of seconds.");
  points = points.map((point) => ({ ...point, time: point.time + offset }));
  const calibration = readJson(values.corners);
  const corners = Array.isArray(calibration) ? calibration : calibration.corners;
  if (!Array.isArray(corners) || corners.length !== 4) fail("--corners needs four points.");
  homography = computeHomography(corners, courtDestinationCorners());
}

const evaluation = evaluateAgainstAnnotation(annotation, points, homography, {
  mode: values.mode,
  rules: findPreset(values.preset),
  sideChanges: values["marked-ends"] ? annotation.sideChanges : undefined,
});
const { summary, games } = evaluation;

const time = (seconds) => (seconds === null ? "?" : formatAnalysisTime(seconds));
const problems = evaluation.rallies.filter(
  (rally) => rally.found.length !== 1 || rally.winnerRight === false,
);
console.log(`Rallies with problems (${problems.length}):`);
for (const rally of problems) {
  const found = rally.found
    .map((item) => `${time(item.t)} ${item.winner}${item.countsTowardScore ? "" : " (review)"}`)
    .join(", ");
  console.log(
    `  #${rally.index} ${time(rally.start)}-${time(rally.end)} won by ${rally.annotatedWinner}` +
      `${rally.landingVisible ? "" : " (landing not visible)"}: ${found || "nothing found"}`,
  );
}
const percent = (value) => `${Math.round(value * 1000) / 10}%`;
console.log(`
Annotated rallies   ${summary.annotated}
Found               ${summary.found} (${percent(summary.recall)})
Missed              ${summary.missed}
Extra endings       ${summary.extra}
Winner right        ${summary.winnersRight} (${percent(summary.winnerAccuracy)})
Wrong and counted   ${summary.countedWrong}
Waiting for review  ${summary.pending}
Games (annotation)  ${games.annotated}
Games (app)         ${games.app}${games.appWinner ? `, ${games.appWinner} wins` : ""}`);

if (values.report) writeFileSync(values.report, JSON.stringify(evaluation, null, 2));

const below = [
  ["min-recall", summary.recall],
  ["min-winner-accuracy", summary.winnerAccuracy],
].filter(([flag, value]) => values[flag] !== undefined && value < Number(values[flag]));
if (below.length) {
  console.error(`Below threshold: ${below.map(([flag]) => flag).join(", ")}`);
  process.exit(1);
}
