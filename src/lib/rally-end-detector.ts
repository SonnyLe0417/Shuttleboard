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
  /** V3 only: missing direct detections interrupted the visible landing evidence. */
  directGapPending?: boolean;
}

export interface RallyEndEvent {
  type: "confirmed-end" | "needs-review";
  point: RallyEndSample;
  reasons: string[];
}

export const RALLY_END_HOLD_SECONDS = 1;
export const RALLY_MOVEMENT_SPEED = 0.025;
export const PLAYER_MOTION_LIMIT = 0.6;
export const DIRECT_DETECTION_GAP_SECONDS = 0.4;
export const DIRECT_DETECTION_END_SECONDS = 1;

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

function speedBetween(previous: RallyEndSample | null, current: RallyEndSample) {
  if (!previous) return 0;
  const elapsed = current.time - previous.time;
  if (
    elapsed <= 0 ||
    previous.x === null ||
    previous.y === null ||
    current.x === null ||
    current.y === null
  ) {
    return 0;
  }
  return Math.hypot(current.x - previous.x, current.y - previous.y) / elapsed;
}

function reviewEvent(point: RallyEndSample, reasons: string[]): RallyEndEvent {
  return { type: "needs-review", point, reasons };
}

export function updateRallyEndState(
  current: RallyEndState,
  sample: RallyEndSample,
  options: { directDetectionGaps?: boolean } = {},
): { state: RallyEndState; event: RallyEndEvent | null } {
  const state = { ...current };
  const speed = speedBetween(state.lastVisible, sample);

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
      next.lastVisible = missing ? null : sample;
      next.visibleFrames = missing ? 0 : 1;
      return {
        state: next,
        event: reviewEvent(state.lastVisible, [
          "Direct shuttle detections disappeared before a clear landing was confirmed. Review the last observed position; it may not be the landing.",
        ]),
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
    if (sample.visible && state.lastVisible === null) {
      return {
        state: {
          ...state,
          phase: "active",
          visibleFrames: 1,
          lastVisible: sample,
        },
        event: null,
      };
    }
    if (sample.visible && speed >= RALLY_MOVEMENT_SPEED) {
      const descending =
        state.lastVisible !== null &&
        state.lastVisible.y !== null &&
        sample.y !== null &&
        sample.y > state.lastVisible.y;
      return {
        state: {
          ...createRallyEndState(),
          phase: "active",
          visibleFrames: 1,
          hasMoved: true,
          wasDescending: descending,
          lastVisible: sample,
        },
        event: null,
      };
    }
    return { state, event: null };
  }

  if (!sample.visible || sample.x === null || sample.y === null) {
    if (
      state.phase === "active" &&
      state.hasMoved &&
      state.lastVisible &&
      sample.time - state.lastVisible.time >= RALLY_END_HOLD_SECONDS
    ) {
      return {
        state: { ...createRallyEndState(), phase: "waiting-for-next-rally" },
        event: reviewEvent(state.lastVisible, [
          "The shuttle disappeared before a clear landing was confirmed.",
        ]),
      };
    }
    return { state, event: null };
  }

  state.visibleFrames += 1;
  const previousVisible = state.lastVisible;
  state.lastVisible = sample;
  if (speed >= RALLY_MOVEMENT_SPEED) {
    state.hasMoved = true;
    if (previousVisible && previousVisible.y !== null && sample.y > previousVisible.y) {
      state.wasDescending = true;
    }
  }

  if (state.phase === "idle") {
    state.phase = "active";
    return { state, event: null };
  }

  if (state.phase === "active" && state.hasMoved && speed < RALLY_MOVEMENT_SPEED) {
    state.phase = "possible-end";
    state.candidateSince = sample.time;
    return { state, event: null };
  }

  if (state.phase === "possible-end") {
    if (speed >= RALLY_MOVEMENT_SPEED) {
      state.phase = "active";
      state.candidateSince = null;
      return { state, event: null };
    }

    const heldFor = sample.time - (state.candidateSince ?? sample.time);
    if (heldFor >= RALLY_END_HOLD_SECONDS) {
      const reasons: string[] = [];
      if (!state.wasDescending) {
        reasons.push("The shuttle did not show a clear downward movement.");
      }
      if (!sample.cameraStable) reasons.push("The camera moved during the possible landing.");
      if (sample.playerMotion !== undefined && sample.playerMotion > PLAYER_MOTION_LIMIT) {
        reasons.push("The players were still moving during the possible landing.");
      }

      const event = reasons.length
        ? reviewEvent(sample, reasons)
        : { type: "confirmed-end" as const, point: sample, reasons: [] };
      return {
        state: { ...createRallyEndState(), phase: "waiting-for-next-rally" },
        event,
      };
    }
  }

  return { state, event: null };
}
