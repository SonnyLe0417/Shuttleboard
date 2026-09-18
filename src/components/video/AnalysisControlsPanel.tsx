import { AlertCircle, Pause, Play, RotateCcw } from "lucide-react";
import {
  canRetryAnalysis,
  playbackButtonLabel,
  showsLastHitter,
  type AnalysisMode,
} from "@/lib/analysis-controls";

interface AnalysisControlsPanelProps {
  mode: AnalysisMode;
  showPlayback: boolean;
  playing: boolean;
  status: string;
  error?: string | null;
  lastHitter: "p1" | "p2";
  onTogglePlay: () => void;
  onRestart: () => void;
  onLastHitterChange: (player: "p1" | "p2") => void;
  onRetry: () => void;
  retrying?: boolean;
  canCancel?: boolean;
  onCancel?: () => void;
}

export function AnalysisControlsPanel({
  mode,
  showPlayback,
  playing,
  status,
  error,
  lastHitter,
  onTogglePlay,
  onRestart,
  onLastHitterChange,
  onRetry,
  retrying = false,
  canCancel = false,
  onCancel,
}: AnalysisControlsPanelProps) {
  return (
    <div className="mt-3 rounded-lg border border-border bg-card px-3 py-3">
      {showsLastHitter(mode) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Last hitter before landing</span>
          {(["p1", "p2"] as const).map((player) => (
            <button
              key={player}
              type="button"
              onClick={() => onLastHitterChange(player)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${lastHitter === player ? "bg-primary text-primary-foreground" : "border border-input bg-background"}`}
            >
              {player === "p1" ? "Player 1" : "Player 2"}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {showPlayback && (
          <button
            type="button"
            onClick={onTogglePlay}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
          >
            {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {playbackButtonLabel(playing)}
          </button>
        )}
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-xs font-medium hover:bg-accent"
        >
          <RotateCcw className="h-3 w-3" /> New video
        </button>
        {canCancel && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-2 rounded-md border border-destructive/40 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10"
          >
            Cancel analysis
          </button>
        )}
        {status && <span className="text-xs text-muted-foreground">{status}</span>}
      </div>

      {error && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
          {canRetryAnalysis(error) && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="rounded-md border border-destructive/40 px-2 py-1 text-xs font-semibold"
            >
              {retrying ? "Retrying…" : "Retry analysis"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
