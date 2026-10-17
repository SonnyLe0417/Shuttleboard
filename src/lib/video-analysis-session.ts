import type { AnalysisRally, AnalysisScore } from "./analysis-results";
import type { TrackNetFrameDiagnostics } from "./tracknet-evidence";

export const VIDEO_ANALYSIS_SESSION_KEY = "shuttleboard.video-analysis-session";

export interface SavedVideoAnalysisSession {
  videoKey: string;
  rallies: AnalysisRally[];
  score: AnalysisScore;
  processedVideoUrl: string | null;
  analysisMode: "browser" | "tracknet";
  tracknetJobId?: string;
  tracknetFrameDiagnostics?: TrackNetFrameDiagnostics;
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
  storage.setItem(VIDEO_ANALYSIS_SESSION_KEY, JSON.stringify(session));
}

export function loadVideoAnalysisSession(
  storage: Pick<Storage, "getItem">,
  expectedVideoKey?: string,
): SavedVideoAnalysisSession | null {
  try {
    const raw = storage.getItem(VIDEO_ANALYSIS_SESSION_KEY);
    if (!raw) return null;

    const saved = JSON.parse(raw) as Partial<SavedVideoAnalysisSession>;
    if (
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
    };
  } catch {
    return null;
  }
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
