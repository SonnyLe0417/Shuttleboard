import { useEffect, useRef, useState, type RefObject } from "react";

interface VideoPreviewPanelProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  calibrationCanvasRef: RefObject<HTMLCanvasElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  src: string;
  calibrating: boolean;
  autoPlay: boolean;
  onError: () => void;
  onCalibrationClick: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onLoadedMetadata: () => void;
  onTimeUpdate: () => void;
}

export function VideoPreviewPanel({
  videoRef,
  calibrationCanvasRef,
  overlayRef,
  src,
  calibrating,
  autoPlay,
  onError,
  onCalibrationClick,
  onLoadedMetadata,
  onTimeUpdate,
}: VideoPreviewPanelProps) {
  const stage = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  useEffect(() => {
    const update = () => setFull(document.fullscreenElement === stage.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.current?.requestFullscreen();
      setFullscreenError("");
    } catch {
      setFullscreenError("Full screen is unavailable in this browser.");
    }
  }
  return (
    <div ref={stage} className="club-video-stage">
      <header>
        <span>{calibrating ? "Set your court" : "Match footage"}</span>
        <button onClick={() => void toggleFullscreen()}>
          {full ? "Exit full screen" : "Full screen"}
        </button>
      </header>
      {fullscreenError && <p role="status">{fullscreenError}</p>}
      <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-black">
        <video
          ref={videoRef}
          src={src}
          className="block h-full w-full object-contain"
          preload="auto"
          autoPlay={autoPlay}
          playsInline
          muted
          onError={onError}
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={onTimeUpdate}
        />
        {calibrating && (
          <canvas
            ref={calibrationCanvasRef}
            onClick={onCalibrationClick}
            className="absolute inset-0 block h-full w-full cursor-crosshair"
          />
        )}
        {!calibrating && (
          <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        )}
      </div>
    </div>
  );
}
