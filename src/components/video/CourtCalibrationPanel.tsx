import { useState, type ReactNode } from "react";
import { Play, RotateCcw } from "lucide-react";
import type { Point } from "@/lib/birdie-tracker";
import type { TrackNetSettings } from "@/lib/tracknet-client";
import type { CameraSegment, CameraViewType } from "@/lib/video-camera-segments";

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
  viewType: CameraViewType;
  onViewTypeChange: (viewType: CameraViewType) => void;
  netCorners: Point[];
  calibrationTarget: "court" | "net";
  onCalibrationTargetChange: (target: "court" | "net") => void;
  onResetNetCorners: () => void;
  cameraSegments: CameraSegment[];
  cameraChangePending?: boolean;
  currentTime?: number;
  tracknetSettings: TrackNetSettings;
  onTrackNetSettingsChange: (settings: TrackNetSettings) => void;
  tracknetEngine: "current" | "v3" | "unknown";
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
  viewType,
  onViewTypeChange,
  netCorners,
  calibrationTarget,
  onCalibrationTargetChange,
  onResetNetCorners,
  cameraSegments,
  cameraChangePending = false,
  currentTime = 0,
  tracknetSettings,
  onTrackNetSettingsChange,
  tracknetEngine,
}: CourtCalibrationPanelProps) {
  const [showSegments, setShowSegments] = useState(true);
  const complete = corners.length === 4;

  return (
    <>
      {preview}
      <div className="mt-4 rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground">
          {cameraChangePending
            ? "Camera moved — mark the new court"
            : complete
              ? "Four corners placed"
              : `Tap corner ${corners.length + 1} of 4`}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {cameraChangePending
            ? "Scoring is paused until the new court is confirmed."
            : complete
              ? "All corners marked."
              : CORNER_LABELS[corners.length]}
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

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-foreground">Camera view</span>
          {(["birds-eye", "side-angle"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onViewTypeChange(value)}
              className={`rounded-md px-3 py-1.5 font-semibold ${viewType === value ? "bg-primary text-primary-foreground" : "border border-input bg-background"}`}
            >
              {value === "birds-eye" ? "Birds-eye" : "Side-angle"}
            </button>
          ))}
        </div>

        {analysisMode === "tracknet" && (
          <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3">
            <p className="text-xs font-semibold text-foreground">TrackNet processing</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Running: {tracknetEngine === "unknown" ? "check the server" : tracknetEngine}. V3
              choices apply when the app was started with TRACKNET_ENGINE=v3.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-[11px] text-muted-foreground">
                Backend
                <select
                  value={tracknetSettings.backend}
                  onChange={(event) =>
                    onTrackNetSettingsChange({
                      ...tracknetSettings,
                      backend: event.target.value as TrackNetSettings["backend"],
                      device:
                        event.target.value === "pytorch" && tracknetSettings.device === "GPU"
                          ? "CPU"
                          : tracknetSettings.device,
                    })
                  }
                  className="mt-1 block w-full rounded border border-input bg-background px-2 py-1.5 text-xs text-foreground"
                >
                  <option value="openvino">OpenVINO</option>
                  <option value="pytorch">PyTorch</option>
                </select>
              </label>
              <label className="text-[11px] text-muted-foreground">
                Device
                <select
                  value={tracknetSettings.device}
                  onChange={(event) =>
                    onTrackNetSettingsChange({
                      ...tracknetSettings,
                      device: event.target.value as TrackNetSettings["device"],
                    })
                  }
                  className="mt-1 block w-full rounded border border-input bg-background px-2 py-1.5 text-xs text-foreground"
                >
                  <option value="CPU">CPU</option>
                  <option value="AUTO">AUTO</option>
                  <option value="GPU" disabled={tracknetSettings.backend === "pytorch"}>
                    Intel GPU (OpenVINO)
                  </option>
                </select>
              </label>
              <label className="text-[11px] text-muted-foreground">
                Detection mode
                <select
                  value={tracknetSettings.evalMode}
                  onChange={(event) =>
                    onTrackNetSettingsChange({
                      ...tracknetSettings,
                      evalMode: event.target.value as TrackNetSettings["evalMode"],
                    })
                  }
                  className="mt-1 block w-full rounded border border-input bg-background px-2 py-1.5 text-xs text-foreground"
                >
                  <option value="weight">Accurate overlap</option>
                  <option value="average">Balanced overlap</option>
                  <option value="nonoverlap">Faster non-overlap</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={tracknetSettings.inpaint}
                  onChange={(event) =>
                    onTrackNetSettingsChange({ ...tracknetSettings, inpaint: event.target.checked })
                  }
                />
                Fill missing shuttle path
              </label>
              <label className="text-[11px] text-muted-foreground">
                CPU threads
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={tracknetSettings.intraThreads}
                  onChange={(event) =>
                    onTrackNetSettingsChange({
                      ...tracknetSettings,
                      intraThreads: Math.max(1, Math.min(12, Number(event.target.value) || 1)),
                    })
                  }
                  className="mt-1 block w-full rounded border border-input bg-background px-2 py-1.5 text-xs text-foreground"
                />
              </label>
            </div>
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-foreground">Mark</span>
          {(["court", "net"] as const).map((target) => (
            <button
              key={target}
              type="button"
              onClick={() => onCalibrationTargetChange(target)}
              className={`rounded-md px-3 py-1.5 font-semibold ${calibrationTarget === target ? "bg-primary text-primary-foreground" : "border border-input bg-background"}`}
            >
              {target === "court"
                ? `Court corners (${corners.length}/4)`
                : `Net corners (${netCorners.length}/4)`}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onReset}
            className="rounded-md border border-input bg-background px-3 py-2 text-xs font-medium hover:bg-accent"
          >
            <RotateCcw className="mr-1 inline h-3 w-3" /> Reset corners
          </button>
          <button
            type="button"
            onClick={onResetNetCorners}
            className="rounded-md border border-input bg-background px-3 py-2 text-xs font-medium hover:bg-accent"
          >
            Reset net
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
                : cameraChangePending
                  ? "Continue analysis"
                  : "Start analysis"}
          </button>
        </div>
        {message && <p className="mt-2 text-xs text-destructive">{message}</p>}

        <div className="mt-3 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setShowSegments((value) => !value)}
            className="text-xs font-semibold text-muted-foreground"
          >
            {showSegments ? "Hide" : "Show"} camera timeline ({cameraSegments.length})
          </button>
          {showSegments && (
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              {cameraSegments.length === 0 ? (
                <p>No camera changes detected yet.</p>
              ) : (
                cameraSegments.map((segment) => (
                  <p key={segment.id}>
                    View {segment.id}:{" "}
                    {segment.viewType === "birds-eye" ? "Birds-eye" : "Side-angle"} ·{" "}
                    {segment.startTime.toFixed(1)}s
                    {segment.endTime === null
                      ? `–now (${currentTime.toFixed(1)}s)`
                      : `–${segment.endTime.toFixed(1)}s`}
                  </p>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
