export type AnalysisMode = "browser" | "tracknet";

export function playbackButtonLabel(playing: boolean) {
  return playing ? "Pause" : "Resume";
}

export function showsLastHitter(mode: AnalysisMode) {
  return mode === "browser";
}

export function canRetryAnalysis(error: string | null | undefined) {
  return Boolean(error);
}

export function keepRetryState<T extends { videoUrl: string | null; corners: unknown[] }>(
  state: T,
) {
  return { videoUrl: state.videoUrl, corners: state.corners };
}
