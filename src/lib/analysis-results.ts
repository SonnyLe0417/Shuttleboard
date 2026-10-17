import type { TrackNetPoint } from "./tracknet-client";
import { isDirectTrackNetDetection, type TrackNetFrameDiagnostics } from "./tracknet-evidence";

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
}

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

export function scoreAfterWinnerCorrection(
  score: AnalysisScore,
  previousWinner: "p1" | "p2",
  nextWinner: "p1" | "p2",
) {
  if (previousWinner === nextWinner) return score;
  return {
    p1: score.p1 + (nextWinner === "p1" ? 1 : -1),
    p2: score.p2 + (nextWinner === "p2" ? 1 : -1),
  };
}

export function applyRallyCorrection(
  rallies: AnalysisRally[],
  score: AnalysisScore,
  id: number,
  patch: AnalysisRallyPatch,
) {
  const previous = rallies.find((rally) => rally.id === id);
  if (!previous) return { rallies, score };

  return {
    rallies: rallies.map((rally) =>
      rally.id === id ? { ...rally, ...patch, manuallyCorrected: true } : rally,
    ),
    score:
      patch.winner && patch.winner !== previous.winner && rallyCountsTowardScore(previous)
        ? scoreAfterWinnerCorrection(score, previous.winner, patch.winner)
        : score,
  };
}

export function getDownloadFileName() {
  return "tracknet_predict.mp4";
}

export function getRallyReviewReasons(
  rally: Pick<
    AnalysisRally,
    "aiConfidence" | "evidenceFrames" | "offCamera" | "landingCourtX" | "landingCourtY"
  >,
) {
  const reasons: string[] = [];
  if (rally.aiConfidence < 0.75) reasons.push("AI confidence is low.");
  if (rally.evidenceFrames !== undefined && rally.evidenceFrames < 8) {
    reasons.push("The landing evidence is short.");
  }
  if (rally.offCamera) reasons.push("The shuttle left the camera view before a clear landing.");
  const nearBoundary =
    rally.landingCourtX < 0.05 ||
    rally.landingCourtX > 0.95 ||
    rally.landingCourtY < 0.05 ||
    rally.landingCourtY > 0.95;
  if (nearBoundary) reasons.push("The landing is close to a court boundary.");
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

export function setRallyReviewStatus(
  rallies: AnalysisRally[],
  id: number,
  status: RallyReviewStatus,
) {
  return rallies.map((rally) =>
    rally.id === id
      ? {
          ...rally,
          reviewStatus: status,
          needsReview: status === "needs-review",
          countsTowardScore: status !== "needs-review",
        }
      : rally,
  );
}
