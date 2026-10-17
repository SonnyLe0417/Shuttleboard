import type { TrackNetPoint } from "./tracknet-client";
import type { AnalysisRally } from "./analysis-results";
import { getRallyReviewReasons } from "./analysis-results";
import { applyHomography } from "./birdie-tracker";
import { isDirectTrackNetDetection } from "./tracknet-evidence";

// GitHub's visible-rest thresholds, applied only to direct TrackNet sightings.
const REST_SECONDS = 0.8;
const STILL_FRACTION = 0.8;
const STILL_SPEED = 0.03;
const MAX_DIRECT_STEP_SECONDS = 0.35;
const REST_DEBOUNCE_SECONDS = 0.4;
const SERVE_READY_MAX_Y = 0.35;
const APPROACH_LOOKBACK_SECONDS = 1.2;
const MIN_DOWNWARD_APPROACH = 0.04;
const OFF_CAMERA_TOP = 0.14;
const OFF_CAMERA_SIDE = 0.04;
const IMAGE_SLACK = 0.02;
const COURT_SLACK = 0.02;

interface DirectSample {
  time: number;
  x: number;
  y: number;
  confidence: number;
}

interface RestEpisode {
  startTime: number;
  endTime: number;
  x: number;
  y: number;
  confidence: number;
  evidenceFrames: number;
  startIndex: number;
}

/** Score uploaded videos only; live-camera tracking has its own state machine. */
export function buildTrackNetRallies(
  points: TrackNetPoint[],
  homography: number[],
): AnalysisRally[] {
  if (!validHomography(homography)) return [];
  const ordered = points
    .filter((point) => Number.isFinite(point.time))
    .slice()
    .sort((a, b) => a.time - b.time || a.frame - b.frame);
  const spans: DirectSample[][] = [];
  let span: DirectSample[] = [];
  for (const point of ordered) {
    if (isDirectTrackNetDetection(point) && validImagePosition(point.x!, point.y!)) {
      if (span.length && point.time - span.at(-1)!.time > MAX_DIRECT_STEP_SECONDS) {
        spans.push(span);
        span = [];
      }
      span.push({
        time: point.time,
        x: point.x!,
        y: point.y!,
        confidence: Number.isFinite(point.confidence) ? point.confidence : 0,
      });
    } else if (span.length) {
      spans.push(span);
      span = [];
    }
  }
  if (span.length) spans.push(span);

  const rallies: AnalysisRally[] = [];
  let lastRestEnd = Number.NEGATIVE_INFINITY;
  for (const directSpan of spans) {
    for (const rest of findRestEpisodes(directSpan)) {
      const court = applyHomography(homography, { x: rest.x, y: rest.y });
      const inBounds =
        Number.isFinite(court.x) &&
        Number.isFinite(court.y) &&
        court.x >= -COURT_SLACK &&
        court.x <= 1 + COURT_SLACK &&
        court.y >= -COURT_SLACK &&
        court.y <= 1 + COURT_SLACK;
      const offCamera =
        rest.y < OFF_CAMERA_TOP || rest.x < OFF_CAMERA_SIDE || rest.x > 1 - OFF_CAMERA_SIDE;
      // A held shuttle in the service area is not a landing unless it was
      // directly seen moving downward just before it stopped. Edge/outside
      // cases remain visible as review proposals, never automatic points.
      if (
        inBounds &&
        !offCamera &&
        rest.y <= SERVE_READY_MAX_Y &&
        !hadDownwardApproach(directSpan, rest)
      )
        continue;
      if (rest.startTime - lastRestEnd < REST_DEBOUNCE_SECONDS) continue;
      lastRestEnd = rest.endTime;
      const reviewReasons = getRallyReviewReasons({
        aiConfidence: rest.confidence,
        evidenceFrames: rest.evidenceFrames,
        offCamera,
        landingCourtX: court.x,
        landingCourtY: court.y,
      });
      if (!inBounds) reviewReasons.push("The landing is outside the court.");
      const needsReview = reviewReasons.length > 0;
      rallies.push({
        id: rallies.length + 1,
        t: rest.endTime,
        landingImgX: rest.x,
        landingImgY: rest.y,
        landingCourtX: court.x,
        landingCourtY: court.y,
        inBounds,
        winner: court.y > 0.5 ? "p2" : "p1",
        aiConfidence: rest.confidence,
        aiNote: needsReview
          ? reviewReasons.join(" ")
          : "TrackNet scored from a directly seen shuttle resting on the court.",
        evidenceFrames: rest.evidenceFrames,
        offCamera,
        needsReview,
        reviewReasons,
        countsTowardScore: !needsReview,
        reviewStatus: needsReview ? "needs-review" : undefined,
      });
    }
  }
  return rallies;
}

function validHomography(h: number[]): boolean {
  if (!Array.isArray(h) || h.length !== 9 || !h.every(Number.isFinite)) return false;
  const [a, b, c, d, e, f, g, i, j] = h;
  const determinant = a * (e * j - f * i) - b * (d * j - f * g) + c * (d * i - e * g);
  return Math.abs(determinant) > 1e-9;
}

function validImagePosition(x: number, y: number): boolean {
  return x >= -IMAGE_SLACK && x <= 1 + IMAGE_SLACK && y >= -IMAGE_SLACK && y <= 1 + IMAGE_SLACK;
}

function findRestEpisodes(samples: readonly DirectSample[]): RestEpisode[] {
  if (samples.length < 2) return [];
  const still = samples.slice(1).map((sample, index) => {
    const previous = samples[index];
    const elapsed = sample.time - previous.time;
    return (
      elapsed > 0 &&
      Math.hypot(sample.x - previous.x, sample.y - previous.y) / Math.max(elapsed, 1 / 240) <=
        STILL_SPEED
    );
  });
  const stillPrefix = [0];
  for (const isStill of still) stillPrefix.push(stillPrefix.at(-1)! + Number(isStill));

  const runs: Array<{ start: number; end: number }> = [];
  let start = -1;
  for (let i = 0; i < still.length; i++) {
    if (still[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      runs.push({ start, end: i });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ start, end: still.length });

  // Allow a little jitter inside an otherwise stationary episode.
  const merged: typeof runs = [];
  for (const run of runs) {
    const previous = merged.at(-1);
    if (previous) {
      const steps = run.end - previous.start;
      const stillCount = stillPrefix[run.end] - stillPrefix[previous.start];
      if (stillCount / steps >= STILL_FRACTION) {
        previous.end = run.end;
        continue;
      }
    }
    merged.push({ ...run });
  }

  return merged
    .filter((run) => samples[run.end].time - samples[run.start].time >= REST_SECONDS)
    .map((run) => {
      const section = samples.slice(run.start, run.end + 1);
      return {
        startTime: section[0].time,
        endTime: section.at(-1)!.time,
        x: section.reduce((sum, sample) => sum + sample.x, 0) / section.length,
        y: section.reduce((sum, sample) => sum + sample.y, 0) / section.length,
        confidence: section.reduce((sum, sample) => sum + sample.confidence, 0) / section.length,
        evidenceFrames: section.length,
        startIndex: run.start,
      };
    });
}

function hadDownwardApproach(samples: readonly DirectSample[], rest: RestEpisode): boolean {
  const earliest = rest.startTime - APPROACH_LOOKBACK_SECONDS;
  let minY = Number.POSITIVE_INFINITY;
  let lastY: number | null = null;
  for (let i = 0; i <= rest.startIndex; i++) {
    const sample = samples[i];
    if (sample.time < earliest) continue;
    minY = Math.min(minY, sample.y);
    lastY = sample.y;
  }
  return lastY !== null && lastY - minY >= MIN_DOWNWARD_APPROACH;
}
