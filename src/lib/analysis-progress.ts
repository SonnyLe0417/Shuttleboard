export type AnalysisProgressPhase =
  "idle" | "uploading" | "queued" | "processing" | "completed" | "failed";

export function formatAnalysisEta(seconds: number | null | undefined) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  const rounded = Math.ceil(seconds);
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  return remaining ? `${minutes}m ${remaining}s` : `${minutes}m`;
}

export function analysisProgressLabel(phase: AnalysisProgressPhase) {
  return {
    idle: "Waiting to start",
    uploading: "Uploading video",
    queued: "Waiting to start",
    processing: "Analyzing video",
    completed: "Analysis complete",
    failed: "Analysis failed",
  }[phase];
}
