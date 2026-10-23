import type { TrackNetPoint } from "./tracknet-client";

export function hasVisibleTrackNetPosition(point: TrackNetPoint) {
  return (
    point.visible === true &&
    point.x !== null &&
    point.y !== null &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

export function isDirectTrackNetDetection(point: TrackNetPoint) {
  // Missing provenance fields are supported for the original TrackNet service.
  return hasVisibleTrackNetPosition(point) && point.detected !== false && point.repaired !== true;
}

export interface TrackNetFrameDiagnostics {
  totalFrames: number;
  directFrames: number;
  repairedFrames: number;
  missingFrames: number;
  durationSeconds: number;
}

export function summarizeTrackNetFrames(points: TrackNetPoint[]): TrackNetFrameDiagnostics {
  const result = {
    totalFrames: points.length,
    directFrames: 0,
    repairedFrames: 0,
    missingFrames: 0,
    durationSeconds: 0,
  };
  for (const point of points) {
    if (isDirectTrackNetDetection(point)) result.directFrames++;
    else if (hasVisibleTrackNetPosition(point) && point.repaired === true) result.repairedFrames++;
    else result.missingFrames++;
  }
  if (points.length > 1) {
    result.durationSeconds = Math.max(0, points[points.length - 1].time - points[0].time);
  }
  return result;
}

// Result arrays are immutable and chronological. Cache only visible points;
// WeakMap lets a previous video's index be collected when it is discarded.
const trailIndexes = new WeakMap<TrackNetPoint[], TrackNetPoint[]>();

/** Used only by playback; retains both observed and repaired positions. */
export function trackNetVisualTrail(points: TrackNetPoint[], time: number, limit = 40) {
  if (limit <= 0 || Number.isNaN(time)) return [];
  let visible = trailIndexes.get(points);
  if (!visible) {
    visible = points.filter(hasVisibleTrackNetPosition);
    trailIndexes.set(points, visible);
  }
  let low = 0;
  let high = visible.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (visible[middle].time <= time) low = middle + 1;
    else high = middle;
  }
  return visible.slice(Math.max(0, low - limit), low);
}
