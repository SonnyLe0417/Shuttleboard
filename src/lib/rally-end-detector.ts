export type RallyEndPhase = "idle" | "active" | "possible-end" | "waiting-for-next-rally";

export interface RallyEndSample {
  time: number;
  x: number | null;
  y: number | null;
  visible: boolean;
  confidence: number;
  cameraStable: boolean;
  /** 0 means still, 1 means strong player movement. Unknown is allowed. */
  playerMotion?: number;
}

export interface RallyEndState {
  phase: RallyEndPhase;
  visibleFrames: number;
  hasMoved: boolean;
  wasDescending: boolean;
  lastVisible: RallyEndSample | null;
  candidateSince: number | null;
  /** When the shuttle last moved down the picture; a landing falls just before it stops. */
  lastDescentAt?: number | null;
  /** Where the last rally ended. The next one starts only once the shuttle leaves it. */
  restAnchor?: RallyEndSample | null;
  /** V3 only: missing direct detections interrupted the visible landing evidence. */
  directGapPending?: boolean;
}

export interface RallyEndEvent {
  type: "confirmed-end" | "needs-review";
  point: RallyEndSample;
  reasons: string[];
  /** False when the shuttle vanished, so `point` is only where it was last seen. */
  landingSeen: boolean;
  /** When the shuttle came to rest (the event itself fires a hold later). */
  landingTime: number;
}

export const RALLY_END_HOLD_SECONDS = 1;
export const RALLY_MOVEMENT_SPEED = 0.025;
export const PLAYER_MOTION_LIMIT = 0.6;
export const DIRECT_DETECTION_GAP_SECONDS = 0.4;
export const DIRECT_DETECTION_END_SECONDS = 1;
/** Positions further apart in time than this say nothing about speed. */
export const MAX_SPEED_GAP_SECONDS = 0.5;
export const DESCENT_WINDOW_SECONDS = 1;
/** How far the shuttle must move from where the last rally ended to start a new one. */
export const REARM_DISTANCE = 0.05;
/**
 * Rallies are separated by the shuttle being fetched and the next serve being
 * set up. Play sooner than this after an end (a shuttle knocked back to the
 * server, or swept off the court) is not a new rally.
 */
export const REARM_AFTER_SECONDS = 4;

export function createRallyEndState(): RallyEndState {
  return {
    phase: "idle",
    visibleFrames: 0,
    hasMoved: false,
    wasDescending: false,
    lastVisible: null,
    candidateSince: null,
  };
}

type Motion = "moving" | "still" | "unknown";

/**
 * Sightings close in time give a speed. Across a longer gap only a clear
 * change of place shows movement; a similar position says nothing about
 * whether the shuttle stayed still while unseen.
 */
function motionBetween(previous: RallyEndSample | null, current: RallyEndSample): Motion {
  if (!previous) return "unknown";
  const elapsed = current.time - previous.time;
  if (
    elapsed <= 0 ||
    previous.x === null ||
    previous.y === null ||
    current.x === null ||
    current.y === null
  ) {
    return "unknown";
  }
  const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
  if (elapsed > MAX_SPEED_GAP_SECONDS) return distance > REARM_DISTANCE ? "moving" : "unknown";
  return distance / elapsed >= RALLY_MOVEMENT_SPEED ? "moving" : "still";
}

function reviewEvent(
  point: RallyEndSample,
  reasons: string[],
  landingSeen = true,
  landingTime = point.time,
): RallyEndEvent {
  return { type: "needs-review", point, reasons, landingSeen, landingTime };
}

export function updateRallyEndState(
  current: RallyEndState,
  sample: RallyEndSample,
  options: { directDetectionGaps?: boolean } = {},
): { state: RallyEndState; event: RallyEndEvent | null } {
  const state = { ...current };
  const motion = motionBetween(state.lastVisible, sample);

  // Opt in only for provenance-aware V3 results. Legacy/browser timing stays unchanged.
  if (
    options.directDetectionGaps &&
    (state.phase === "active" || state.phase === "possible-end") &&
    state.hasMoved &&
    state.lastVisible
  ) {
    const elapsed = sample.time - state.lastVisible.time;
    const missing = !sample.visible || sample.x === null || sample.y === null;
    if (elapsed >= DIRECT_DETECTION_END_SECONDS) {
      // Also handles sparse results where no rows were supplied during the gap.
      const next = createRallyEndState();
      next.phase = missing ? "waiting-for-next-rally" : "active";
      next.restAnchor = state.lastVisible;
      next.lastVisible = missing ? null : sample;
      next.visibleFrames = missing ? 0 : 1;
      return {
        state: next,
        event: reviewEvent(
          state.lastVisible,
          [
            "Direct shuttle detections disappeared before a clear landing was confirmed. Review the last observed position; it may not be the landing.",
          ],
          false,
        ),
      };
    }
    if (missing) {
      state.directGapPending = true;
      // A missing interval must never count as time spent visibly resting on the floor.
      state.candidateSince = null;
      state.phase = elapsed >= DIRECT_DETECTION_GAP_SECONDS ? "possible-end" : "active";
      return { state, event: null };
    }
    if (state.directGapPending) {
      state.directGapPending = false;
      state.phase = "active";
      state.candidateSince = null;
    }
  }

  if (state.phase === "waiting-for-next-rally") {
    if (!sample.visible || sample.x === null || sample.y === null) return { state, event: null };
    const anchor = state.restAnchor;
    // The shuttle lying where it landed, or nudged on the spot, is not a new rally.
    const leftSpot =
      !anchor ||
      anchor.x === null ||
      anchor.y === null ||
      Math.hypot(sample.x - anchor.x, sample.y - anchor.y) > REARM_DISTANCE;
    const deadTimeOver = !anchor || sample.time - anchor.time >= REARM_AFTER_SECONDS;
    if (leftSpot && deadTimeOver && motion === "moving") {
      const descending =
        state.lastVisible !== null &&
        state.lastVisible.y !== null &&
        sample.time - state.lastVisible.time <= MAX_SPEED_GAP_SECONDS &&
        sample.y > state.lastVisible.y;
      return {
        state: {
          ...createRallyEndState(),
          phase: "active",
          visibleFrames: 1,
          hasMoved: true,
          wasDescending: descending,
          lastDescentAt: descending ? sample.time : null,
          lastVisible: sample,
        },
        event: null,
      };
    }
    return { state: { ...state, lastVisible: sample }, event: null };
  }

  if (!sample.visible || sample.x === null || sample.y === null) {
    if (
      state.phase === "active" &&
      state.hasMoved &&
      state.lastVisible &&
      sample.time - state.lastVisible.time >= RALLY_END_HOLD_SECONDS
    ) {
      return {
        state: {
          ...createRallyEndState(),
          phase: "waiting-for-next-rally",
          restAnchor: state.lastVisible,
        },
        event: reviewEvent(
          state.lastVisible,
          ["The shuttle disappeared before a clear landing was confirmed."],
          false,
        ),
      };
    }
    return { state, event: null };
  }

  state.visibleFrames += 1;
  const previousVisible = state.lastVisible;
  state.lastVisible = sample;
  if (motion === "moving") {
    state.hasMoved = true;
    const observed =
      previousVisible !== null && sample.time - previousVisible.time <= MAX_SPEED_GAP_SECONDS;
    if (observed && previousVisible.y !== null && sample.y > previousVisible.y) {
      state.wasDescending = true;
      state.lastDescentAt = sample.time;
    }
  }

  if (state.phase === "idle") {
    state.phase = "active";
    return { state, event: null };
  }

  if (state.phase === "active" && state.hasMoved && motion === "still") {
    state.phase = "possible-end";
    state.candidateSince = sample.time;
    return { state, event: null };
  }

  if (state.phase === "possible-end") {
    if (motion === "moving") {
      state.phase = "active";
      state.candidateSince = null;
      return { state, event: null };
    }

    const heldFor = sample.time - (state.candidateSince ?? sample.time);
    if (heldFor >= RALLY_END_HOLD_SECONDS) {
      const reasons: string[] = [];
      const landingTime = state.candidateSince ?? sample.time;
      // Any earlier descent in the rally (or the jump of a pickup) does not count.
      const descended =
        state.lastDescentAt !== undefined &&
        state.lastDescentAt !== null &&
        landingTime - state.lastDescentAt <= DESCENT_WINDOW_SECONDS;
      if (!descended) {
        reasons.push("The shuttle did not show a clear downward movement.");
      }
      if (!sample.cameraStable) reasons.push("The camera moved during the possible landing.");
      if (sample.playerMotion !== undefined && sample.playerMotion > PLAYER_MOTION_LIMIT) {
        reasons.push("The players were still moving during the possible landing.");
      }

      // A stop with no fall before it (a pickup, a held serve) is not a landing.
      const event: RallyEndEvent = reasons.length
        ? reviewEvent(sample, reasons, descended, landingTime)
        : { type: "confirmed-end", point: sample, reasons: [], landingSeen: true, landingTime };
      return {
        state: { ...createRallyEndState(), phase: "waiting-for-next-rally", restAnchor: sample },
        event,
      };
    }
  }

  return { state, event: null };
}
