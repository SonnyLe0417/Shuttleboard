import type { Point } from "@/lib/birdie-tracker";

export const COURT_CORNER_COUNT = 4;

export function addCourtCorner(corners: Point[], point: Point) {
  return corners.length >= COURT_CORNER_COUNT ? corners : [...corners, point];
}

export function hasFourCourtCorners(corners: Point[]) {
  return corners.length === COURT_CORNER_COUNT;
}

export function pointFromCanvasClick(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  canvasWidth: number,
  canvasHeight: number,
): Point {
  return {
    x: ((clientX - rect.left) / rect.width) * canvasWidth,
    y: ((clientY - rect.top) / rect.height) * canvasHeight,
  };
}

export function courtDestinationCorners(): Point[] {
  return [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 0 },
    { x: 0, y: 0 },
  ];
}

export function loadCourtCalibration(raw: string | null) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { corners?: unknown; homography?: unknown };
    if (
      !Array.isArray(value.corners) ||
      !hasFourCourtCorners(value.corners as Point[]) ||
      !Array.isArray(value.homography) ||
      value.homography.length !== 9 ||
      !value.corners.every(
        (point) =>
          Boolean(point) &&
          typeof point === "object" &&
          Number.isFinite((point as Point).x) &&
          Number.isFinite((point as Point).y),
      )
    ) {
      return null;
    }
    return { corners: value.corners as Point[], homography: value.homography as number[] };
  } catch {
    return null;
  }
}

export function saveCourtCalibration(corners: Point[], homography: number[]) {
  if (!hasFourCourtCorners(corners) || homography.length !== 9) return null;
  return JSON.stringify({ corners, homography });
}
