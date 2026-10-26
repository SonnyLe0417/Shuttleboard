import type { TrackNetPoint } from "./tracknet-client";
import type { AnalysisRally } from "./analysis-results";
import { getRallyReviewReasons, landingAmbiguityReasons } from "./analysis-results";
import { applyHomography } from "./birdie-tracker";
import { isDirectTrackNetDetection } from "./tracknet-evidence";
import { type CourtEnd, type GameMode, rallyLanding } from "./badminton";

// A rally is a run of fast shuttle flight. It starts with a serve, after the
// quiet spell in which the last shuttle is picked up, carried and held, and it
// ends at the first rest that settles straight after the last flight. Rests
// between rallies (lying on the floor, in a hand, before the serve) are never
// landings. Speeds are in normalized image units per second.
const FLIGHT_SPEED = 0.25;
// Slow shots (a net shot into the tape) still move; they keep a rally's landing
// window open but cannot start or prolong a rally on their own.
const MOVING_SPEED = 0.08;
// A pickup or a flick of the racket is a step or two; even a one-second
// service fault is many samples of flight.
const MIN_FLIGHT_SAMPLES = 3;
const MAX_STEP_SECONDS = 0.35;
const RALLY_QUIET_SECONDS = 2.5;
const LANDING_WINDOW_SECONDS = 1.5;
const SERVE_GAP_SECONDS = 4;
// A rest stays within a small radius (about three cells of TrackNetV3's
// 512x288 output) for long enough. Unseen time is not evidence of a rest, so
// only a dropped frame or two is bridged; a longer occlusion splits the rest,
// and the later piece cannot start a new rally.
const REST_SECONDS = 0.8;
const REST_RADIUS = 0.006;
const REST_MAX_GAP_SECONDS = 0.11;
const REST_MIN_SAMPLES = 4;
// A lone stray detection inside a rest does not end it.
const REST_STRAY_FRACTION = 0.2;
const APPROACH_LOOKBACK_SECONDS = 1.2;
const MIN_DOWNWARD_APPROACH = 0.04;
// Which end served. A server stands behind their short service line (court y
// 0.648 near, 0.352 far), and a shuttle held above the floor only ever
// projects further from the camera. So a held shuttle projecting short of the
// far service line is the far server's, and one well on the near side is the
// near server's. Without a visible hold, only the launch point is left, which
// can be in front of the server, so it needs a clearer margin.
const HOLD_BEFORE_SERVE_SECONDS = 1;
const HELD_NEAR_MIN_COURT_Y = 0.4;
const HELD_FAR_MAX_COURT_Y = 0.34;
const LAUNCH_NEAR_MIN_COURT_Y = 0.6;
const LAUNCH_FAR_MAX_COURT_Y = 0.25;
const IMAGE_EDGE = 0.01;
const IMAGE_SLACK = 0.02;

interface DirectSample {
  time: number;
  x: number;
  y: number;
  confidence: number;
}

interface Rest {
  startTime: number;
  endTime: number;
  x: number;
  y: number;
  confidence: number;
  evidenceFrames: number;
  startIndex: number;
}

interface Cluster {
  start: number;
  /** Index of the sample the serve was launched from. */
  launchIndex: number;
  lastFlight: number;
  lastFlightIndex: number;
  lastMotion: number;
  flightSamples: number;
  /** Quiet before the first flight, so a serve rather than part of a rally. */
  isServe: boolean;
  landing: Rest | null;
}

export interface TrackNetRallyOptions {
  mode?: GameMode;
}

/** Score uploaded videos only; live-camera tracking has its own state machine. */
export function buildTrackNetRallies(
  points: TrackNetPoint[],
  homography: number[],
  options: TrackNetRallyOptions = {},
): AnalysisRally[] {
  if (!validHomography(homography)) return [];
  const mode = options.mode ?? "singles";
  const samples = directSamples(points);
  const rests = findRests(samples);
  const clusters = findRallies(samples, rests);

  const rallies: AnalysisRally[] = [];
  clusters.forEach((cluster, index) => {
    const serveEnd = cluster.isServe ? servingEnd(samples, rests, cluster, homography) : undefined;
    const base = { startT: cluster.start, ...(serveEnd ? { serveEnd } : {}) };
    if (cluster.landing) {
      rallies.push({
        ...landedRally(samples, cluster.landing, homography, mode),
        ...base,
        id: rallies.length + 1,
      });
      return;
    }
    // A landing nobody saw still ended a rally if the next one was served.
    if (clusters[index + 1]?.isServe) {
      rallies.push({
        ...unseenRally(samples, cluster, homography),
        ...base,
        id: rallies.length + 1,
      });
    }
  });
  return rallies;
}

function directSamples(points: TrackNetPoint[]): DirectSample[] {
  return points
    .filter(
      (point) =>
        Number.isFinite(point.time) &&
        isDirectTrackNetDetection(point) &&
        validImagePosition(point.x!, point.y!),
    )
    .slice()
    .sort((a, b) => a.time - b.time || a.frame - b.frame)
    .map((point) => ({
      time: point.time,
      x: point.x!,
      y: point.y!,
      confidence: Number.isFinite(point.confidence) ? point.confidence : 0,
    }));
}

function stepSpeed(samples: readonly DirectSample[], index: number) {
  if (index < 1) return 0;
  const from = samples[index - 1];
  const to = samples[index];
  const elapsed = to.time - from.time;
  if (elapsed <= 0 || elapsed > MAX_STEP_SECONDS) return 0;
  return Math.hypot(to.x - from.x, to.y - from.y) / elapsed;
}

/** Windows where the shuttle stays put, allowing whole-cell flicker and dropped frames. */
function findRests(samples: readonly DirectSample[]): Rest[] {
  const rests: Rest[] = [];
  let start = 0;
  while (start < samples.length) {
    const anchor = samples[start];
    const onSpot = (index: number) =>
      Math.hypot(samples[index].x - anchor.x, samples[index].y - anchor.y) <= REST_RADIUS;
    const linked = (index: number) =>
      samples[index].time - samples[index - 1].time <= REST_MAX_GAP_SECONDS;
    const kept = [start];
    let strays = 0;
    let next = start + 1;
    while (next < samples.length && linked(next)) {
      if (onSpot(next)) {
        kept.push(next++);
        continue;
      }
      const back = next + 1 < samples.length && linked(next + 1) && onSpot(next + 1);
      if (!back || (strays + 1) / (kept.length + strays + 1) > REST_STRAY_FRACTION) break;
      strays++;
      next++;
    }
    const last = samples[kept.at(-1)!];
    if (last.time - anchor.time >= REST_SECONDS && kept.length >= REST_MIN_SAMPLES) {
      const section = kept.map((index) => samples[index]);
      const mean = (pick: (sample: DirectSample) => number) =>
        section.reduce((sum, sample) => sum + pick(sample), 0) / section.length;
      rests.push({
        startTime: anchor.time,
        endTime: last.time,
        x: mean((sample) => sample.x),
        y: mean((sample) => sample.y),
        confidence: mean((sample) => sample.confidence),
        evidenceFrames: section.length,
        startIndex: start,
      });
      start = kept.at(-1)! + 1;
    } else {
      start++;
    }
  }
  return rests;
}

function findRallies(samples: readonly DirectSample[], rests: readonly Rest[]): Cluster[] {
  const clusters: Cluster[] = [];
  let current: Cluster | null = null;
  let lastFlight = Number.NEGATIVE_INFINITY;
  let restIndex = 0;

  const close = () => {
    if (current) clusters.push(current);
    current = null;
  };
  const onRest = (rest: Rest) => {
    if (!current) return; // the shuttle lying, carried or held between rallies
    if (
      rest.startTime - current.lastFlight <= RALLY_QUIET_SECONDS &&
      rest.startTime - current.lastMotion <= LANDING_WINDOW_SECONDS
    )
      current.landing = rest;
    close();
  };

  for (let i = 1; i < samples.length; i++) {
    const speed = stepSpeed(samples, i);
    if (speed < MOVING_SPEED) continue;
    const time = samples[i].time;
    while (restIndex < rests.length && rests[restIndex].startTime < time)
      onRest(rests[restIndex++]);
    if (current && time - current.lastFlight > RALLY_QUIET_SECONDS) close();
    if (speed < FLIGHT_SPEED) {
      if (current) current.lastMotion = time;
      continue;
    }
    if (!current) {
      const previous = clusters.at(-1);
      if (time - lastFlight >= SERVE_GAP_SECONDS || !previous) {
        current = {
          start: time,
          launchIndex: i - 1,
          lastFlight: time,
          lastFlightIndex: i,
          lastMotion: time,
          flightSamples: 0,
          isServe: true,
          landing: null,
        };
      } else if (!previous.landing) {
        // The shuttle went out of view mid-rally and came back.
        current = clusters.pop()!;
      }
      // Otherwise this is a flick between rallies, after a landing was seen.
    }
    if (current) {
      current.lastFlight = time;
      current.lastFlightIndex = i;
      current.lastMotion = time;
      current.flightSamples++;
    }
    lastFlight = time;
  }
  while (restIndex < rests.length) onRest(rests[restIndex++]);
  close();
  return clusters.filter((cluster) => cluster.flightSamples >= MIN_FLIGHT_SAMPLES);
}

function landedRally(
  samples: readonly DirectSample[],
  rest: Rest,
  homography: number[],
  mode: GameMode,
): Omit<AnalysisRally, "id"> {
  const court = applyHomography(homography, { x: rest.x, y: rest.y });
  const finite = Number.isFinite(court.x) && Number.isFinite(court.y);
  const landing = finite ? rallyLanding(court.x, court.y, mode) : null;
  const offCamera =
    rest.x < IMAGE_EDGE ||
    rest.x > 1 - IMAGE_EDGE ||
    rest.y < IMAGE_EDGE ||
    rest.y > 1 - IMAGE_EDGE;
  const reviewReasons = getRallyReviewReasons(
    {
      aiConfidence: rest.confidence,
      evidenceFrames: rest.evidenceFrames,
      offCamera,
      landingCourtX: court.x,
      landingCourtY: court.y,
    },
    mode,
  );
  if (!finite) reviewReasons.push("The landing could not be placed on the court.");
  const ambiguity = finite ? landingAmbiguityReasons(court.x, court.y, mode) : [];
  // Far-court drops can look flat from behind the near baseline. Only rests
  // inside a rally get here, so this is doubt about the call, not a held shuttle.
  if (!hadDownwardApproach(samples, rest)) {
    const reason = "The shuttle was not seen coming down before it stopped.";
    reviewReasons.push(reason);
    ambiguity.push(reason);
  }
  const needsReview = reviewReasons.length > 0;
  return {
    t: rest.startTime,
    landingImgX: rest.x,
    landingImgY: rest.y,
    landingCourtX: court.x,
    landingCourtY: court.y,
    inBounds: landing?.isIn ?? false,
    // Provisional: the match timeline maps ends to players once games are known.
    winner: landing?.winnerEnd === "far" ? "p2" : "p1",
    landingEnd: landing?.end,
    landingSeen: true,
    landingAmbiguous: needsReview && ambiguity.length === reviewReasons.length,
    aiConfidence: rest.confidence,
    aiNote: needsReview
      ? reviewReasons.join(" ")
      : `TrackNet saw the shuttle land ${landing?.isIn ? "in" : "out"} at the ${landing?.end} end.`,
    evidenceFrames: rest.evidenceFrames,
    offCamera,
    needsReview,
    reviewReasons,
    countsTowardScore: !needsReview,
    reviewStatus: needsReview ? "needs-review" : undefined,
  };
}

function unseenRally(
  samples: readonly DirectSample[],
  cluster: Cluster,
  homography: number[],
): Omit<AnalysisRally, "id"> {
  const last = samples[cluster.lastFlightIndex];
  const court = applyHomography(homography, { x: last.x, y: last.y });
  const reason =
    "The landing was not seen. Check the video; the next serve suggests who won the rally.";
  return {
    t: cluster.lastFlight,
    landingImgX: last.x,
    landingImgY: last.y,
    landingCourtX: court.x,
    landingCourtY: court.y,
    inBounds: false,
    winner: "p1",
    landingSeen: false,
    aiConfidence: last.confidence,
    aiNote: reason,
    evidenceFrames: 0,
    offCamera: true,
    needsReview: true,
    reviewReasons: [reason],
    countsTowardScore: false,
    reviewStatus: "needs-review",
  };
}

function servingEnd(
  samples: readonly DirectSample[],
  rests: readonly Rest[],
  cluster: Cluster,
  homography: number[],
): CourtEnd | undefined {
  let hold: Rest | undefined;
  for (const rest of rests) {
    if (rest.endTime > cluster.start) break;
    if (cluster.start - rest.endTime <= HOLD_BEFORE_SERVE_SECONDS) hold = rest;
  }
  const point = hold ?? samples[cluster.launchIndex];
  const court = applyHomography(homography, { x: point.x, y: point.y });
  if (!Number.isFinite(court.y)) return undefined;
  const nearFrom = hold ? HELD_NEAR_MIN_COURT_Y : LAUNCH_NEAR_MIN_COURT_Y;
  const farTo = hold ? HELD_FAR_MAX_COURT_Y : LAUNCH_FAR_MAX_COURT_Y;
  if (court.y >= nearFrom) return "near";
  if (court.y <= farTo) return "far";
  return undefined;
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

/** A landing falls: it moves down the picture just before it stops. */
function hadDownwardApproach(samples: readonly DirectSample[], rest: Rest): boolean {
  const earliest = rest.startTime - APPROACH_LOOKBACK_SECONDS;
  let minY = Number.POSITIVE_INFINITY;
  for (let i = rest.startIndex; i >= 0 && samples[i].time >= earliest; i--) {
    minY = Math.min(minY, samples[i].y);
  }
  return samples[rest.startIndex].y - minY >= MIN_DOWNWARD_APPROACH;
}
