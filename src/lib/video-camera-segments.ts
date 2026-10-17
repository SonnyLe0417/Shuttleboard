import type { Point } from "./birdie-tracker";

export type CameraViewType = "birds-eye" | "side-angle";

export interface CameraSegment {
  id: number;
  startTime: number;
  endTime: number | null;
  viewType: CameraViewType;
  corners: Point[];
  netCorners: Point[];
  homography: number[];
}

export interface CameraMotionState {
  largeShiftFrames: number;
  lastTime: number;
}

// The local detector reports camera shift as a fraction of the frame. Its
// search window is six pixels at 640px, so a persistent shift around 0.7% is
// already meaningful.
export const CAMERA_SHIFT_LIMIT = 0.007;
export const CAMERA_SHIFT_FRAMES = 3;

export function createCameraMotionState(): CameraMotionState {
  return { largeShiftFrames: 0, lastTime: 0 };
}

export function updateCameraMotion(state: CameraMotionState, shift: Point, time: number) {
  const magnitude = Math.hypot(shift.x, shift.y);
  const largeShiftFrames = magnitude >= CAMERA_SHIFT_LIMIT ? state.largeShiftFrames + 1 : 0;
  return {
    state: { largeShiftFrames, lastTime: time },
    needsRecalibration: largeShiftFrames >= CAMERA_SHIFT_FRAMES,
  };
}

export function createCameraSegment(
  id: number,
  startTime: number,
  viewType: CameraViewType,
  corners: Point[],
  netCorners: Point[],
  homography: number[],
): CameraSegment {
  return {
    id,
    startTime,
    endTime: null,
    viewType,
    corners: corners.map((point) => ({ ...point })),
    netCorners: netCorners.map((point) => ({ ...point })),
    homography: [...homography],
  };
}

export function closeCameraSegment(segments: CameraSegment[], endTime: number) {
  if (!segments.length) return segments;
  return segments.map((segment, index) =>
    index === segments.length - 1 ? { ...segment, endTime } : segment,
  );
}

export function segmentForTime(segments: CameraSegment[], time: number) {
  return (
    segments.find(
      (segment) =>
        time >= segment.startTime && (segment.endTime === null || time < segment.endTime),
    ) ??
    segments[segments.length - 1] ??
    null
  );
}
