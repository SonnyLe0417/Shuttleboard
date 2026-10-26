import type { AnalysisRally, AnalysisScore } from "./analysis-results";
import type { GameMode } from "./badminton";
import { PRESETS } from "./badminton-rules";
import type { TrackNetFrameDiagnostics } from "./tracknet-evidence";
import { DEFAULT_VIDEO_MATCH_SETTINGS, type VideoMatchSettings } from "./video-match";

export const VIDEO_ANALYSIS_SESSION_KEY = "shuttleboard.video-analysis-session";
/**
 * Bump when rally evidence or scoring changes. Reviews saved under older rules
 * carry winners from the old rules, so they are dropped rather than shown.
 */
export const VIDEO_SCORING_VERSION = 2;

export interface SavedVideoAnalysisSession {
  videoKey: string;
  rallies: AnalysisRally[];
  score: AnalysisScore;
  processedVideoUrl: string | null;
  analysisMode: "browser" | "tracknet";
  tracknetJobId?: string;
  tracknetFrameDiagnostics?: TrackNetFrameDiagnostics;
  matchSettings?: VideoMatchSettings;
  gameMode?: GameMode;
}

export interface VideoFileIdentity {
  name: string;
  size: number;
  lastModified: number;
}

export function createVideoSessionKey(file: VideoFileIdentity) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function saveVideoAnalysisSession(
  storage: Pick<Storage, "setItem">,
  session: SavedVideoAnalysisSession,
) {
  storage.setItem(
    VIDEO_ANALYSIS_SESSION_KEY,
    JSON.stringify({ ...session, scoringVersion: VIDEO_SCORING_VERSION }),
  );
}

export function loadVideoAnalysisSession(
  storage: Pick<Storage, "getItem">,
  expectedVideoKey?: string,
): SavedVideoAnalysisSession | null {
  try {
    const raw = storage.getItem(VIDEO_ANALYSIS_SESSION_KEY);
    if (!raw) return null;

    const saved = JSON.parse(raw) as Partial<SavedVideoAnalysisSession> & {
      scoringVersion?: number;
    };
    if (
      saved.scoringVersion !== VIDEO_SCORING_VERSION ||
      typeof saved.videoKey !== "string" ||
      (expectedVideoKey && saved.videoKey !== expectedVideoKey) ||
      !Array.isArray(saved.rallies) ||
      !saved.score ||
      typeof saved.score.p1 !== "number" ||
      typeof saved.score.p2 !== "number"
    ) {
      return null;
    }

    return {
      videoKey: saved.videoKey,
      rallies: saved.rallies,
      score: { p1: saved.score.p1, p2: saved.score.p2 },
      processedVideoUrl:
        typeof saved.processedVideoUrl === "string" ? saved.processedVideoUrl : null,
      analysisMode: saved.analysisMode === "tracknet" ? "tracknet" : "browser",
      tracknetJobId: typeof saved.tracknetJobId === "string" ? saved.tracknetJobId : undefined,
      tracknetFrameDiagnostics: validFrameDiagnostics(saved.tracknetFrameDiagnostics)
        ? saved.tracknetFrameDiagnostics
        : undefined,
      matchSettings: validMatchSettings(saved.matchSettings)
        ? saved.matchSettings
        : DEFAULT_VIDEO_MATCH_SETTINGS,
      gameMode: saved.gameMode === "doubles" ? "doubles" : "singles",
    };
  } catch {
    return null;
  }
}

function validMatchSettings(value: unknown): value is VideoMatchSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as VideoMatchSettings;
  return (
    PRESETS.some((preset) => preset.id === settings.presetId) &&
    (settings.initialNear === "p1" || settings.initialNear === "p2") &&
    Array.isArray(settings.sideChanges) &&
    settings.sideChanges.every(
      (change) => Number.isFinite(change?.at) && (change.near === "p1" || change.near === "p2"),
    )
  );
}

function validFrameDiagnostics(value: unknown): value is TrackNetFrameDiagnostics {
  if (!value || typeof value !== "object") return false;
  const stats = value as TrackNetFrameDiagnostics;
  return (
    [stats.totalFrames, stats.directFrames, stats.repairedFrames, stats.missingFrames].every(
      (count) => Number.isInteger(count) && count >= 0,
    ) &&
    Number.isFinite(stats.durationSeconds) &&
    stats.durationSeconds >= 0 &&
    stats.totalFrames === stats.directFrames + stats.repairedFrames + stats.missingFrames
  );
}

export function clearVideoAnalysisSession(storage: Pick<Storage, "removeItem">) {
  storage.removeItem(VIDEO_ANALYSIS_SESSION_KEY);
}
