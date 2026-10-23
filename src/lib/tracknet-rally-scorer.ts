import { applyHomography } from "@/lib/birdie-tracker";
import { getRallyReviewReasons, type AnalysisRally } from "@/lib/analysis-results";
import type { TrackNetPoint } from "@/lib/tracknet-client";

const IMAGE_EPS = 0.02;
const BOUNDS_SLACK = 0.02;
const REST_MIN_DURATION = 0.8;
const REST_STILL_FRACTION = 0.8;
const REST_STILL_SPEED = 0.03;
const REST_DEBOUNCE = 0.4;
const IN_HAND_RADIUS = 0.08;
const SERVE_READY_MAX_Y = 0.35;
const APPROACH_LOOKBACK = 1.2;
const MIN_DOWNWARD_APPROACH = 0.04;
const MIN_STEP_DT = 1 / 240;
const OFF_CAMERA_TOP = 0.14;
const OFF_CAMERA_SIDE = 0.04;
const DET_EPS = 1e-9;

interface VisibleSample {
  frame: number;
  time: number;
  x: number;
  y: number;
  confidence: number;
}

interface ImagePoint {
  x: number;
  y: number;
}

interface VisibleSpan {
  kind: "visible";
  samples: VisibleSample[];
}

interface InvisibleSpan {
  kind: "invisible";
  startTime: number;
  endTime: number;
}

type TraceSpan = VisibleSpan | InvisibleSpan;

interface RestEpisode {
  startTime: number;
  endTime: number;
  duration: number;
  centroid: ImagePoint;
  stillFraction: number;
  sampleCount: number;
  meanConfidence: number;
  startIndex: number;
}

interface CourtLanding {
  image: ImagePoint;
  courtX: number;
  courtY: number;
  inBounds: boolean;
}

type RestVerdict =
  | {
      kind: "score";
      episode: RestEpisode;
      landing: CourtLanding;
      winner: "p1" | "p2";
    }
  | {
      kind: "review";
      episode: RestEpisode;
      landing: CourtLanding;
      winner: "p1" | "p2";
      offCamera: boolean;
    }
  | {
      kind: "in-hand";
      episode: RestEpisode;
      reason: "serve-ready-zone" | "player-proximity-stub";
    };

interface PlayerStub {
  x: number;
  y: number;
}

export function buildTrackNetRallies(
  points: TrackNetPoint[],
  homography: number[],
  hints?: { playerStubs?: ReadonlyArray<{ x: number; y: number }> },
): AnalysisRally[] {
  const parsed = parseScoringInput(points, homography);
  if (!parsed) return [];

  const stubs = parseStubs(hints?.playerStubs);
  const kept: Array<Exclude<RestVerdict, { kind: "in-hand" }>> = [];
  let lastEnd = Number.NEGATIVE_INFINITY;

  for (const span of parsed.spans) {
    if (span.kind !== "visible") continue;
    for (const episode of findRestEpisodes(span.samples)) {
      const verdict = classifyRest(episode, span.samples, parsed.homography, stubs);
      if (verdict.kind === "in-hand") continue;
      if (episode.startTime - lastEnd < REST_DEBOUNCE) continue;
      lastEnd = episode.endTime;
      kept.push(verdict);
    }
  }

  return kept.map((verdict, index) => projectRally(verdict, index + 1));
}

function parseScoringInput(points: TrackNetPoint[], homography: number[]) {
  const H = parseHomography(homography);
  if (!H) return null;

  const ordered = points
    .filter((point) => Number.isFinite(point.time))
    .slice()
    .sort((a, b) => a.time - b.time || a.frame - b.frame);

  const spans: TraceSpan[] = [];
  let visible: VisibleSample[] = [];
  let gapStart: number | null = null;
  let gapEnd = 0;

  const flushVisible = () => {
    if (!visible.length) return;
    spans.push({ kind: "visible", samples: visible });
    visible = [];
  };
  const flushGap = (endTime: number) => {
    if (gapStart === null) return;
    spans.push({ kind: "invisible", startTime: gapStart, endTime });
    gapStart = null;
  };

  for (const point of ordered) {
    const sample = asVisibleSample(point);
    if (sample) {
      flushGap(sample.time);
      visible.push(sample);
      continue;
    }
    flushVisible();
    if (gapStart === null) gapStart = point.time;
    gapEnd = point.time;
  }
  flushVisible();
  flushGap(gapEnd);

  return { spans, homography: H };
}

function parseHomography(raw: number[]): number[] | null {
  if (!Array.isArray(raw) || raw.length !== 9) return null;
  if (!raw.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  const [a, b, c, d, e, f, g, h, i] = raw;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < DET_EPS) return null;
  return raw;
}

function asVisibleSample(point: TrackNetPoint): VisibleSample | null {
  if (!point.visible) return null;
  const { x, y } = point;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < -IMAGE_EPS || x > 1 + IMAGE_EPS || y < -IMAGE_EPS || y > 1 + IMAGE_EPS) return null;
  return {
    frame: Number.isFinite(point.frame) ? point.frame : 0,
    time: point.time,
    x,
    y,
    confidence: Number.isFinite(point.confidence) ? point.confidence : 0,
  };
}

function parseStubs(stubs: ReadonlyArray<{ x: number; y: number }> | undefined): PlayerStub[] {
  if (!stubs) return [];
  return stubs.filter((stub) => Number.isFinite(stub.x) && Number.isFinite(stub.y));
}

function stepIsStill(from: VisibleSample, to: VisibleSample) {
  const dt = Math.max(to.time - from.time, MIN_STEP_DT);
  const speed = Math.hypot(to.x - from.x, to.y - from.y) / dt;
  return speed <= REST_STILL_SPEED;
}

function findRestEpisodes(samples: readonly VisibleSample[]): RestEpisode[] {
  const n = samples.length;
  if (n < 2) return [];

  const stillStep = new Array<boolean>(n - 1);
  for (let i = 0; i < n - 1; i++) stillStep[i] = stepIsStill(samples[i], samples[i + 1]);

  const runs: Array<{ start: number; end: number }> = [];
  let runStart: number | null = null;
  let runEnd = 0;
  for (let i = 0; i < n - 1; i++) {
    if (stillStep[i]) {
      if (runStart === null) runStart = i;
      runEnd = i + 1;
    } else if (runStart !== null) {
      runs.push({ start: runStart, end: runEnd });
      runStart = null;
    }
  }
  if (runStart !== null) runs.push({ start: runStart, end: runEnd });

  const merged: Array<{ start: number; end: number }> = [];
  for (const run of runs) {
    const prev = merged.at(-1);
    if (!prev) {
      merged.push({ ...run });
      continue;
    }
    const steps = run.end - prev.start;
    let stillCount = 0;
    for (let i = prev.start; i < run.end; i++) if (stillStep[i]) stillCount += 1;
    if (steps > 0 && stillCount / steps >= REST_STILL_FRACTION) prev.end = run.end;
    else merged.push({ ...run });
  }

  const episodes: RestEpisode[] = [];
  for (const run of merged) {
    const duration = samples[run.end].time - samples[run.start].time;
    if (duration < REST_MIN_DURATION) continue;
    episodes.push(makeEpisode(samples, stillStep, run.start, run.end));
  }
  return episodes;
}

function makeEpisode(
  samples: readonly VisibleSample[],
  stillStep: readonly boolean[],
  start: number,
  end: number,
): RestEpisode {
  const first = samples[start];
  let sx = 0;
  let sy = 0;
  let sc = 0;
  let stillCount = 0;
  let sameX = true;
  let sameY = true;
  for (let i = start; i <= end; i++) {
    const sample = samples[i];
    if (sample.x !== first.x) sameX = false;
    if (sample.y !== first.y) sameY = false;
    sx += sample.x;
    sy += sample.y;
    sc += sample.confidence;
    if (i < end && stillStep[i]) stillCount += 1;
  }
  const count = end - start + 1;
  const steps = end - start;
  return {
    startTime: first.time,
    endTime: samples[end].time,
    duration: samples[end].time - first.time,
    centroid: { x: sameX ? first.x : sx / count, y: sameY ? first.y : sy / count },
    stillFraction: steps > 0 ? stillCount / steps : 1,
    sampleCount: count,
    meanConfidence: sc / count,
    startIndex: start,
  };
}

function classifyRest(
  episode: RestEpisode,
  span: readonly VisibleSample[],
  homography: number[],
  stubs: readonly PlayerStub[],
): RestVerdict {
  if (nearPlayerStub(episode.centroid, stubs)) {
    return { kind: "in-hand", episode, reason: "player-proximity-stub" };
  }

  const landing = projectCourtLanding(homography, episode.centroid);
  const winner: "p1" | "p2" = landing.courtY > 0.5 ? "p2" : "p1";
  const offCamera = restOffCamera(episode.centroid);
  if (
    offCamera ||
    !landing.inBounds ||
    !Number.isFinite(landing.courtX) ||
    !Number.isFinite(landing.courtY)
  ) {
    return { kind: "review", episode, landing, winner, offCamera };
  }
  if (episode.centroid.y <= SERVE_READY_MAX_Y && !hadDownwardApproach(span, episode)) {
    return { kind: "in-hand", episode, reason: "serve-ready-zone" };
  }
  return { kind: "score", episode, landing, winner };
}

function nearPlayerStub(centroid: ImagePoint, stubs: readonly PlayerStub[]) {
  return stubs.some(
    (stub) => Math.hypot(centroid.x - stub.x, centroid.y - stub.y) <= IN_HAND_RADIUS,
  );
}

function hadDownwardApproach(span: readonly VisibleSample[], episode: RestEpisode) {
  const from = episode.startTime - APPROACH_LOOKBACK;
  let minY = Number.POSITIVE_INFINITY;
  let lastY: number | null = null;
  for (let i = 0; i <= episode.startIndex; i++) {
    const sample = span[i];
    if (sample.time < from || sample.time > episode.startTime) continue;
    minY = Math.min(minY, sample.y);
    lastY = sample.y;
  }
  if (lastY === null || !Number.isFinite(minY)) return false;
  return lastY - minY >= MIN_DOWNWARD_APPROACH;
}

function restOffCamera(point: ImagePoint) {
  return point.y < OFF_CAMERA_TOP || point.x < OFF_CAMERA_SIDE || point.x > 1 - OFF_CAMERA_SIDE;
}

function projectCourtLanding(homography: number[], image: ImagePoint): CourtLanding {
  const court = applyHomography(homography, image);
  const inBounds =
    Number.isFinite(court.x) &&
    Number.isFinite(court.y) &&
    court.x >= -BOUNDS_SLACK &&
    court.x <= 1 + BOUNDS_SLACK &&
    court.y >= -BOUNDS_SLACK &&
    court.y <= 1 + BOUNDS_SLACK;
  return { image, courtX: court.x, courtY: court.y, inBounds };
}

function projectRally(
  verdict: Exclude<RestVerdict, { kind: "in-hand" }>,
  id: number,
): AnalysisRally {
  const { episode, landing, winner } = verdict;
  const offCamera = verdict.kind === "review" ? verdict.offCamera : false;
  const reviewReasons = getRallyReviewReasons({
    aiConfidence: episode.meanConfidence,
    evidenceFrames: episode.sampleCount,
    offCamera,
    landingCourtX: landing.courtX,
    landingCourtY: landing.courtY,
  });
  if (!landing.inBounds) reviewReasons.push("The landing is outside the court.");

  const needsReview = reviewReasons.length > 0;
  return {
    id,
    t: episode.endTime,
    landingImgX: landing.image.x,
    landingImgY: landing.image.y,
    landingCourtX: landing.courtX,
    landingCourtY: landing.courtY,
    inBounds: landing.inBounds,
    winner,
    aiConfidence: episode.meanConfidence,
    aiNote: needsReview
      ? reviewReasons.join(" ")
      : "TrackNet scored from a visible rest on the court.",
    evidenceFrames: episode.sampleCount,
    offCamera,
    needsReview,
    reviewReasons,
    countsTowardScore: landing.inBounds && !offCamera,
    reviewStatus: needsReview ? "needs-review" : undefined,
  };
}
