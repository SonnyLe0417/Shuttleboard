import type { TrackNetPoint } from "./tracknet-client";
import { isDirectTrackNetDetection, type TrackNetFrameDiagnostics } from "./tracknet-evidence";
import { COURT, COURT_LENGTH_M, COURT_WIDTH_M, type CourtEnd, type GameMode } from "./badminton";

export type ShotType = "unknown" | "smash" | "clear" | "drop" | "drive" | "lift" | "net";
export type RallyReviewStatus = "needs-review" | "confirmed" | "corrected";
export type RallyReviewFilter = "all" | RallyReviewStatus;

export interface AnalysisRally {
  id: number;
  t: number;
  landingImgX: number;
  landingImgY: number;
  landingCourtX: number;
  landingCourtY: number;
  inBounds: boolean;
  winner: "p1" | "p2";
  aiConfidence: number;
  aiNote: string;
  evidenceFrames?: number;
  offCamera?: boolean;
  needsReview?: boolean;
  reviewReasons?: string[];
  countsTowardScore?: boolean;
  reviewStatus?: RallyReviewStatus;
  shotType?: ShotType;
  manuallyCorrected?: boolean;
  /** When the rally was served (its first fast flight), if seen. */
  startT?: number;
  /** End of the court the shuttle came to rest on; missing when no landing was seen. */
  landingEnd?: CourtEnd;
  landingSeen?: boolean;
  /** Only a line or the net makes the call uncertain, so a matching next serve settles it. */
  landingAmbiguous?: boolean;
  /** Which end served this rally, when the serve position was clear. */
  serveEnd?: CourtEnd;
  /** The vision check's winner, as the end they were at (browser analysis). */
  aiWinnerEnd?: CourtEnd;
  /**
   * The reviewer's decisions. Winners are kept as the end the winner was at,
   * which is what the reviewer judged, so they follow any later correction of
   * who started where or when the players changed ends.
   */
  reviewerWinnerEnd?: CourtEnd;
  /** The reviewer said whether the rally counts; undefined leaves it to the evidence. */
  reviewerCounts?: boolean;
  /** The reviewer made the in/out call, so it stands over the next serve. */
  reviewerCall?: boolean;
  /** Not a rally at all (a knock-up, a pickup): left out of the score and of the ends. */
  excluded?: boolean;
  /** Filled in by the match timeline. */
  decidedBy?: RallyDecision;
  /** Who was at the near end while this rally was played. */
  near?: "p1" | "p2";
  game?: number;
  scoreAfter?: AnalysisScore;
  afterMatch?: boolean;
}

export type RallyDecision =
  | "landing"
  | "next serve"
  | "landing and next serve"
  | "vision check"
  | "vision check and next serve"
  | "reviewer";

export interface AnalysisScore {
  p1: number;
  p2: number;
}

export type AnalysisRallyPatch = Partial<Pick<AnalysisRally, "winner" | "inBounds" | "shotType">>;

export const EMPTY_RALLIES_MESSAGE =
  "No rallies scored yet. They will appear here as the shuttle lands.";

export function formatAnalysisTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function countTrackNetDetections(points: TrackNetPoint[] = []) {
  return points.filter((point) => point.visible).length;
}

export function averageTrackNetConfidence(points: TrackNetPoint[] = []) {
  const visible = points.filter(isDirectTrackNetDetection);
  if (!visible.length) return 0;
  return Math.round(
    (visible.reduce((total, point) => total + point.confidence, 0) / visible.length) * 100,
  );
}

/** The end a player was at during a rally, as the match timeline resolved it. */
function endOf(player: AnalysisRally["winner"], shown?: Pick<AnalysisRally, "near">): CourtEnd {
  return player === (shown?.near ?? "p1") ? "near" : "far";
}

/**
 * Applies a reviewer's correction to the rally as shown (`shown` is the
 * resolved rally, so the reviewer's pick is stored against the right end).
 * Choosing a winner pins it. Marking a landing in or out makes the in/out
 * call the reviewer's, which hands the rally to the other player at the same
 * spot. A rally that was counted stays counted. A shot label is only a label.
 */
export function correctRally(
  rallies: AnalysisRally[],
  id: number,
  patch: AnalysisRallyPatch,
  shown?: AnalysisRally,
) {
  return rallies.map((rally) => {
    if (rally.id !== id) return rally;
    const next = { ...rally, ...patch };
    if (patch.winner === undefined && patch.inBounds === undefined) return next;
    const counted = rallyCountsTowardScore(shown ?? rally);
    if (patch.winner !== undefined) {
      next.reviewerWinnerEnd = endOf(patch.winner, shown);
    } else if (patch.inBounds !== rally.inBounds) {
      next.reviewerWinnerEnd = undefined;
      next.reviewerCall = true;
      // Without a recorded landing end, flip the stored winner directly.
      if (!rally.landingEnd) next.winner = rally.winner === "p1" ? "p2" : "p1";
    }
    if (counted) next.reviewerCounts = true;
    next.manuallyCorrected = true;
    next.reviewStatus = counted ? "corrected" : "needs-review";
    return next;
  });
}

/** Marks a detection as not being a rally, or brings it back. */
export function excludeRally(rallies: AnalysisRally[], id: number, excluded: boolean) {
  return rallies.map((rally) => (rally.id === id ? { ...rally, excluded } : rally));
}

export function getDownloadFileName() {
  return "tracknet_predict.mp4";
}

const LINE_BAND_M = 0.15;
const NET_BAND_M = 0.6;
// Further out than this the shuttle was more likely knocked or carried there.
const FAR_OUT_M = 2;

/** Landings where tracking error could change the call, measured on the real court. */
export function landingAmbiguityReasons(courtX: number, courtY: number, mode: GameMode) {
  const reasons: string[] = [];
  const side = mode === "singles" ? COURT.singlesSideline : 0;
  const dx = Math.min(Math.abs(courtX - side), Math.abs(courtX - (1 - side))) * COURT_WIDTH_M;
  const dy = Math.min(Math.abs(courtY), Math.abs(courtY - 1)) * COURT_LENGTH_M;
  if (Math.min(dx, dy) < LINE_BAND_M) reasons.push("The landing is on or near a boundary line.");
  const outX = Math.max(side - courtX, courtX - (1 - side), 0) * COURT_WIDTH_M;
  const outY = Math.max(-courtY, courtY - 1, 0) * COURT_LENGTH_M;
  if (Math.hypot(outX, outY) > FAR_OUT_M) {
    reasons.push("The shuttle stopped far outside the court.");
  }
  if (Math.abs(courtY - COURT.center) * COURT_LENGTH_M < NET_BAND_M) {
    reasons.push("The landing is close to the net, so which side it fell on is uncertain.");
  }
  return reasons;
}

export function getRallyReviewReasons(
  rally: Pick<
    AnalysisRally,
    "aiConfidence" | "evidenceFrames" | "offCamera" | "landingCourtX" | "landingCourtY"
  >,
  mode: GameMode = "singles",
) {
  const reasons: string[] = [];
  if (rally.aiConfidence < 0.75) reasons.push("AI confidence is low.");
  if (rally.evidenceFrames !== undefined && rally.evidenceFrames < 8) {
    reasons.push("The landing evidence is short.");
  }
  if (rally.offCamera) reasons.push("The shuttle left the camera view before a clear landing.");
  if (Number.isFinite(rally.landingCourtX) && Number.isFinite(rally.landingCourtY)) {
    reasons.push(...landingAmbiguityReasons(rally.landingCourtX, rally.landingCourtY, mode));
  }
  return reasons;
}

export function rallyNeedsReview(
  rally: Pick<
    AnalysisRally,
    "aiConfidence" | "evidenceFrames" | "offCamera" | "landingCourtX" | "landingCourtY"
  >,
) {
  return getRallyReviewReasons(rally).length > 0;
}

export function rallyCountsTowardScore(rally: Pick<AnalysisRally, "countsTowardScore">) {
  return rally.countsTowardScore !== false;
}

export function scoreFromRallies(rallies: AnalysisRally[]): AnalysisScore {
  return rallies.reduce(
    (score, rally) => {
      if (rallyCountsTowardScore(rally)) score[rally.winner]++;
      return score;
    },
    { p1: 0, p2: 0 },
  );
}

export function rallyDiagnostics(rallies: AnalysisRally[]) {
  const confirmedEndings = rallies.filter(rallyCountsTowardScore).length;
  return {
    possibleEndings: rallies.length,
    confirmedEndings,
    needsReview: rallies.length - confirmedEndings,
  };
}

export function sparseRallyWarning(frames: TrackNetFrameDiagnostics, rallies: AnalysisRally[]) {
  // A diagnostic hint, not a target rally count or an estimate of match points.
  return frames.durationSeconds >= 60 && frames.directFrames >= 30 && rallies.length <= 5
    ? "TrackNet detected the shuttle, but only a few rally endings were clear. Review the processed video or adjust the detection settings. This is not the match's full point count."
    : null;
}

export function reviewFilterMatches(
  rally: Pick<AnalysisRally, "reviewStatus" | "needsReview" | "manuallyCorrected">,
  filter: RallyReviewFilter,
) {
  if (filter === "all") return true;
  const status =
    rally.reviewStatus ??
    (rally.manuallyCorrected ? "corrected" : rally.needsReview ? "needs-review" : undefined);
  return status === filter;
}

/**
 * The reviewer decides whether a rally counts. Confirming counts it with the
 * winner shown. Keeping it for review takes it out of the score but leaves it
 * in the reading of games and ends, with the evidence's suggestion.
 */
export function setRallyReviewStatus(
  rallies: AnalysisRally[],
  id: number,
  status: RallyReviewStatus,
  shown?: AnalysisRally,
) {
  return rallies.map((rally) =>
    rally.id === id
      ? {
          ...rally,
          reviewerWinnerEnd:
            status === "confirmed" && shown
              ? endOf(shown.winner, shown)
              : status === "needs-review"
                ? undefined
                : rally.reviewerWinnerEnd,
          reviewerCounts: status !== "needs-review",
          reviewStatus: status,
          needsReview: status === "needs-review",
          countsTowardScore: status !== "needs-review",
        }
      : rally,
  );
}
