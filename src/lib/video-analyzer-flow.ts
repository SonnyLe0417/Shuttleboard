import type { TrackNetPoint } from "./tracknet-client";

export type AnalyzerPhase = "upload" | "calibrate" | "analyze" | "done";

export interface FreshAnalyzerState {
  phase: AnalyzerPhase;
  videoUrl: string | null;
  tracknetVideoUrl: string | null;
  tracknetPoints: TrackNetPoint[];
  corners: unknown[];
  score: { p1: number; p2: number };
  rallies: unknown[];
  selectedRally: number | null;
  status: string;
  error: string | null;
}

export function createFreshAnalyzerState(): FreshAnalyzerState {
  return {
    phase: "upload",
    videoUrl: null,
    tracknetVideoUrl: null,
    tracknetPoints: [],
    corners: [],
    score: { p1: 0, p2: 0 },
    rallies: [],
    selectedRally: null,
    status: "",
    error: null,
  };
}

export function stateAfterUpload(videoUrl: string) {
  return { ...createFreshAnalyzerState(), phase: "calibrate" as const, videoUrl };
}

export function hasRequiredCorners(corners: unknown[]) {
  return corners.length === 4;
}

export function togglePlayback(playing: boolean, currentTime: number) {
  return { playing: !playing, currentTime };
}

export function resultsAreVisible(phase: AnalyzerPhase) {
  return phase === "done";
}

export function canRetryWithSavedVideo(videoUrl: string | null, corners: unknown[]) {
  return Boolean(videoUrl) && corners.length === 4;
}

export function acquireAnalyzerLock(isLocked: boolean) {
  return !isLocked;
}

export function cancellationMessage() {
  return "Analysis cancelled. You can start again with the same video.";
}

export function isCurrentAnalysisRun(runId: number, currentRunId: number) {
  return runId === currentRunId;
}

export function showsPlaybackControl(mode: "browser" | "tracknet", phase: AnalyzerPhase) {
  return mode === "browser" && phase === "analyze";
}
