import { AlertCircle, CheckCircle2, RotateCcw } from "lucide-react";
import {
  analysisProgressLabel,
  formatAnalysisEta,
  type AnalysisProgressPhase,
} from "@/lib/analysis-progress";

interface AnalysisProgressPanelProps {
  phase: AnalysisProgressPhase;
  progress: number;
  etaSeconds: number | null;
  error: string | null;
  onRetry: () => void;
  retrying?: boolean;
  onCancel?: () => void;
}

export function AnalysisProgressPanel({
  phase,
  progress,
  etaSeconds,
  error,
  onRetry,
  retrying = false,
  onCancel,
}: AnalysisProgressPanelProps) {
  if (phase === "idle") return null;
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const eta = formatAnalysisEta(etaSeconds);
  const failed = phase === "failed";
  const complete = phase === "completed";
  return (
    <div className="mb-3 rounded-xl border border-border bg-card p-4" role="status">
      <div className="flex items-center gap-2">
        {failed ? (
          <AlertCircle className="h-4 w-4 text-destructive" />
        ) : complete ? (
          <CheckCircle2 className="h-4 w-4 text-primary" />
        ) : null}
        <p className="text-sm font-semibold">{analysisProgressLabel(phase)}</p>
        {!failed && !complete && <span className="ml-auto text-sm tabular-nums">{percent}%</span>}
      </div>
      {!failed && !complete && (
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
          aria-label={`${percent}% complete`}
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      {!failed && !complete && onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 rounded-md border border-destructive/40 px-3 py-2 text-xs font-semibold text-destructive"
        >
          Cancel analysis
        </button>
      )}
      {eta && !failed && !complete && (
        <p className="mt-2 text-xs text-muted-foreground">About {eta} remaining</p>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      {failed && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
        >
          <RotateCcw className="h-3 w-3" /> {retrying ? "Retrying…" : "Retry analysis"}
        </button>
      )}
    </div>
  );
}
