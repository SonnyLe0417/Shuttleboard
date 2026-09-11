import type { RefObject } from "react";

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
  return (
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
  );
}
