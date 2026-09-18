import type { ReactNode } from "react";
import { Play, RotateCcw } from "lucide-react";
import type { Point } from "@/lib/birdie-tracker";

const CORNER_LABELS = [
  "Near-left corner (bottom-left of court)",
  "Near-right corner (bottom-right of court)",
  "Far-right corner (top-right of court)",
  "Far-left corner (top-left of court)",
];

interface CourtCalibrationPanelProps {
  corners: Point[];
  analysisMode: "browser" | "tracknet";
  onReset: () => void;
  onModeChange: (mode: "browser" | "tracknet") => void;
  onStart: () => void;
  starting?: boolean;
  message?: string | null;
  preview: ReactNode;
}

export function CourtCalibrationPanel({
  corners,
  analysisMode,
  onReset,
  onModeChange,
  onStart,
  starting = false,
  message,
  preview,
}: CourtCalibrationPanelProps) {
  const complete = corners.length === 4;
  return (
    <>
      {preview}
      <div className="mt-4 rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground">
          {complete ? "Four corners placed" : `Tap corner ${corners.length + 1} of 4`}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {complete ? "All corners marked." : CORNER_LABELS[corners.length]}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-foreground">Detector</span>
          {(["browser", "tracknet"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onModeChange(mode)}
              className={`rounded-md px-3 py-1.5 font-semibold ${analysisMode === mode ? "bg-primary text-primary-foreground" : "border border-input bg-background"}`}
            >
              {mode === "browser" ? "Browser fallback" : "TrackNet AI"}
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onReset}
            className="rounded-md border border-input bg-background px-3 py-2 text-xs font-medium hover:bg-accent"
          >
            <RotateCcw className="mr-1 inline h-3 w-3" /> Reset corners
          </button>
          <button
            type="button"
            onClick={onStart}
            disabled={!complete || starting}
            className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40"
          >
            <Play className="mr-1 inline h-3 w-3" />
            {starting
              ? "Starting…"
              : analysisMode === "tracknet"
                ? "Analyze with TrackNet"
                : "Start analysis"}
          </button>
        </div>
        {message && <p className="mt-2 text-xs text-destructive">{message}</p>}
      </div>
    </>
  );
}
