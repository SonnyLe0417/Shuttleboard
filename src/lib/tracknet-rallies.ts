import type { TrackNetPoint } from "./tracknet-client";
import type { AnalysisRally } from "./analysis-results";
import { getRallyReviewReasons, landingAmbiguityReasons } from "./analysis-results";
import { applyHomography } from "./birdie-tracker";
import { isDirectTrackNetDetection } from "./tracknet-evidence";
import {
  COURT_LENGTH_M,
  COURT_WIDTH_M,
  type CourtEnd,
  type GameMode,
  rallyLanding,
} from "./badminton";

// A rally is a run of fast shuttle flight. It starts with a serve, after the
// quiet spell in which the last shuttle is picked up, carried and held, and it
// ends at the first rest that settles straight after the last flight. Rests
// between rallies (lying on the floor, in a hand, before the serve) are never
// landings. Speeds are in metres per second across the court plane, so a shot
// at the far end, small in the picture, is as fast as the same shot up close.
const FLIGHT_SPEED = 4;
// Slow shots (a net shot into the tape) still move; they keep a rally's landing
// window open but cannot start or prolong a rally on their own.
const MOVING_SPEED = 1.2;
// A pickup or a flick of the racket is a step or two; even a one-second
// service fault is many samples of flight. A burst of motion only counts for
// anything once it shows this much flight in a short window.
const MIN_FLIGHT_SAMPLES = 3;
const BURST_SECONDS = 0.5;
const MAX_STEP_SECONDS = 0.35;
const SPEED_WINDOW_SECONDS = 0.2;
const RALLY_QUIET_SECONDS = 2.5;
const LANDING_WINDOW_SECONDS = 1.5;
const SERVE_GAP_SECONDS = 4;
// After a landing the shuttle is fetched, often knocked back to the server.
// Play this soon after a seen landing is that, not the next rally, and so is
// a short piece of play soon after a rally whose flight ends this soon before
// a serve. A real rally is followed by more dead time than that.
const RETURN_SECONDS = 6;
const RETURN_FLIGHT_SECONDS = 1.5;
const RETURN_AFTER_LANDING_SECONDS = 10;
// Play that starts from where the last rally's shuttle lay is that shuttle
// being scooped up, unless it crosses the net: the spot can also be where the
// server stands with it, after a knock-back or when the landing was not seen.
const PICKUP_RADIUS = 0.02;
const NET_Y_M = COURT_LENGTH_M / 2;
// A rally whose landing nobody saw is still offered at the end of the video
// when it was real play (a couple of seconds of flight), not a flick.
const LAST_RALLY_FLIGHT_SECONDS = 2;
const LAST_RALLY_FLIGHT_SAMPLES = 15;
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
  /** The position mapped onto the court plane, in metres. */
  courtX: number;
  courtY: number;
}

interface Rest {
  startTime: number;
  endTime: number;
  x: number;
  y: number;
  confidence: number;
  evidenceFrames: number;
  startIndex: number;
  endIndex: number;
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
  /** A rest came too late to be the landing, so the rally is over, landing unseen. */
  closedBy?: Rest;
  /** Launched from where the last rally's shuttle was seen lying. */
  fromRest?: boolean;
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
  const samples = directSamples(points, homography);
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
    // A landing nobody saw still ended a rally if the next one was served, or
    // if it was the last real play in the video.
    const next = clusters[index + 1];
    const lastPlay =
      !next &&
      cluster.lastFlight - cluster.start >= LAST_RALLY_FLIGHT_SECONDS &&
      cluster.flightSamples >= LAST_RALLY_FLIGHT_SAMPLES;
    if (next?.isServe || lastPlay) {
      rallies.push({
        ...unseenRally(samples, cluster, homography),
        ...base,
        id: rallies.length + 1,
      });
    }
  });
  return rallies;
}

function directSamples(points: TrackNetPoint[], homography: number[]): DirectSample[] {
  return points
    .filter(
      (point) =>
        Number.isFinite(point.time) &&
        isDirectTrackNetDetection(point) &&
        validImagePosition(point.x!, point.y!),
    )
    .slice()
    .sort((a, b) => a.time - b.time || a.frame - b.frame)
    .map((point) => {
      const court = applyHomography(homography, { x: point.x!, y: point.y! });
      return {
        time: point.time,
        x: point.x!,
        y: point.y!,
        confidence: Number.isFinite(point.confidence) ? point.confidence : 0,
        courtX: court.x * COURT_WIDTH_M,
        courtY: court.y * COURT_LENGTH_M,
      };
    });
}

/**
 * Speed over the last fifth of a second or so. TrackNet reports whole grid
 * cells, and at the far end one cell is about 15 cm of court, so frame to
 * frame a slowly carried shuttle would look as fast as a shot.
 */
function stepSpeed(samples: readonly DirectSample[], index: number) {
  if (index < 1) return 0;
  const to = samples[index];
  let from = index;
  while (
    from > 0 &&
    to.time - samples[from].time < SPEED_WINDOW_SECONDS &&
    samples[from].time - samples[from - 1].time <= MAX_STEP_SECONDS
  )
    from--;
  const start = samples[from];
  const elapsed = to.time - start.time;
  if (elapsed <= 0 || elapsed > MAX_STEP_SECONDS) return 0;
  const metres = Math.hypot(to.courtX - start.courtX, to.courtY - start.courtY);
  // Near the horizon of the court plane a raised shuttle has no finite
  // position; it is high in the air, so treat it as flying if it moved at all.
  if (!Number.isFinite(metres)) return to.x === start.x && to.y === start.y ? 0 : FLIGHT_SPEED;
  return metres / elapsed;
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
        endIndex: kept.at(-1)!,
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
  let burst: { index: number; time: number; count: number } | null = null;
  let restIndex = 0;

  const crossedNet = (cluster: Cluster) => {
    const side = Math.sign(samples[cluster.launchIndex].courtY - NET_Y_M);
    for (let i = cluster.launchIndex + 1; i <= cluster.lastFlightIndex; i++) {
      if (Math.sign(samples[i].courtY - NET_Y_M) === -side) return true;
    }
    return false;
  };
  const close = () => {
    if (current && (!current.fromRest || admitted(current))) clusters.push(current);
    current = null;
  };
  const onRest = (rest: Rest) => {
    if (!current) return; // the shuttle lying, carried or held between rallies
    if (
      rest.startTime - current.lastFlight <= RALLY_QUIET_SECONDS &&
      rest.startTime - current.lastMotion <= LANDING_WINDOW_SECONDS
    )
      current.landing = rest;
    else current.closedBy = rest;
    close();
  };
  /** Where a rally's shuttle was last seen lying: its landing, or the rest that ended it. */
  const settled = (cluster: Cluster | undefined) => cluster?.landing ?? cluster?.closedBy;
  /** A short piece of play soon after the shuttle came to rest: it going back to the server. */
  const isReturn = (cluster: Cluster, before: Cluster | undefined) => {
    const rest = settled(before);
    return (
      Boolean(rest) &&
      cluster.start - rest!.startTime < RETURN_AFTER_LANDING_SECONDS &&
      cluster.lastFlight - cluster.start < RETURN_FLIGHT_SECONDS
    );
  };
  /** The last cluster was the shuttle knocked back to the server just before `time`. */
  const knockBackBefore = (time: number) => {
    const previous = clusters.at(-1);
    return (
      previous !== undefined &&
      isReturn(previous, clusters.at(-2)) &&
      time - previous.lastFlight < RETURN_SECONDS
    );
  };
  const soonAfterLanding = (cluster: Cluster | undefined, time: number) =>
    cluster?.landing !== undefined &&
    cluster.landing !== null &&
    time - cluster.landing.startTime < RETURN_SECONDS;
  /**
   * Play that left from where the last shuttle lay, judged once it is over: a
   * scoop unless it crossed the net, and otherwise like any other play.
   */
  const admitted = (cluster: Cluster) => {
    if (!crossedNet(cluster)) return false;
    if (knockBackBefore(cluster.start)) clusters.pop();
    return !soonAfterLanding(clusters.at(-1), cluster.start);
  };
  /** The serve leaves the hand: the first flight after a hold that just ended. */
  const serveStart = (burst: {
    index: number;
    time: number;
  }): { index: number; time: number; hold?: Rest } => {
    let hold: Rest | undefined;
    for (const rest of rests) {
      if (rest.endTime > burst.time) break;
      hold = rest;
    }
    // Never reach back into the rally before.
    const previousEnd = clusters.at(-1)?.lastFlight ?? Number.NEGATIVE_INFINITY;
    if (!hold || hold.endTime <= previousEnd || burst.time - hold.endTime > RALLY_QUIET_SECONDS)
      return burst;
    for (let i = hold.endIndex + 1; i <= burst.index; i++) {
      if (stepSpeed(samples, i) >= FLIGHT_SPEED) return { index: i, time: samples[i].time, hold };
    }
    return { ...burst, hold };
  };
  /** What a sustained burst of flight is, once it has proved itself. */
  const startFrom = (burst: { index: number; time: number; count: number }) => {
    const start = serveStart(burst);
    // Where it left from: the spot it rested at just before, when there was one.
    // The sample before the first fast one is already a few frames into the motion.
    const launch = start.hold ?? samples[Math.max(0, start.index - 1)];
    const launchedFrom = (rest: Rest | null | undefined) =>
      Boolean(rest) && Math.hypot(launch.x - rest!.x, launch.y - rest!.y) <= PICKUP_RADIUS;
    const fromRest = launchedFrom(settled(clusters.at(-1)));
    const knockBack = knockBackBefore(start.time);
    // A serve straight after a knock-back replaces it. Play from where the last
    // shuttle lay may be a scoop, so it waits to be admitted when it is over.
    if (knockBack && !fromRest) clusters.pop();
    const previous = clusters.at(knockBack && fromRest ? -2 : -1);
    if (!fromRest && soonAfterLanding(previous, start.time)) return null;
    if (!previous || start.time - previous.lastFlight >= SERVE_GAP_SECONDS) {
      return {
        start: start.time,
        launchIndex: Math.max(0, start.index - 1),
        lastFlight: start.time,
        lastFlightIndex: start.index,
        lastMotion: start.time,
        flightSamples: 0,
        isServe: true,
        landing: null,
        fromRest,
      };
    }
    // The shuttle went out of view mid-rally and came back.
    if (!fromRest && !previous.landing && !previous.closedBy) return clusters.pop()!;
    // Otherwise it is play between rallies.
    return null;
  };

  // A shuttle at rest is not moving, whatever its recent average speed says.
  const resting = new Array<boolean>(samples.length).fill(false);
  for (const rest of rests) resting.fill(true, rest.startIndex, rest.endIndex + 1);

  for (let i = 1; i < samples.length; i++) {
    if (resting[i]) continue;
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
      if (!burst || time - burst.time > BURST_SECONDS) burst = { index: i, time, count: 0 };
      burst.count++;
      if (burst.count < MIN_FLIGHT_SAMPLES) continue;
      current = startFrom(burst);
      if (current) current.flightSamples += burst.count - 1;
      burst = null;
      if (!current) continue;
    }
    current.lastFlight = time;
    current.lastFlightIndex = i;
    current.lastMotion = time;
    current.flightSamples++;
  }
  while (restIndex < rests.length) onRest(rests[restIndex++]);
  close();
  return clusters;
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
