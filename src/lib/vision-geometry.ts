import { type GameMode, rallyLanding } from "@/lib/badminton";
import { type Point, applyHomography, computeHomography } from "@/lib/birdie-tracker";
import { courtDestinationCorners } from "@/lib/court-calibration";

/**
 * Judges a vision landing on the calibrated court. Corners are player 1's back
 * corners first, then player 2's ([p1 left, p1 right, p2 right, p2 left] as
 * seen on camera). The landing is mapped onto the court rather than compared
 * with the midpoints of the sidelines in the picture, which perspective puts
 * well short of the net.
 */
export function judgeVisionLanding(position: Point, corners: readonly Point[], mode: GameMode) {
  const homography = computeHomography([...corners], courtDestinationCorners());
  const court = applyHomography(homography, position);
  if (!Number.isFinite(court.x) || !Number.isFinite(court.y)) return null;
  const landing = rallyLanding(court.x, court.y, mode);
  // Player 1's end maps to court y = 1, the "near" end of the normalized court.
  return {
    call: landing.isIn ? ("in" as const) : ("out" as const),
    pointTo: landing.winnerEnd === "near" ? ("p1" as const) : ("p2" as const),
    court,
  };
}

/** Puts player 1's back corners first, from near-first calibration corners. */
export function cornersForPlayerOne<T>(nearFirst: readonly T[], p1Near: boolean): T[] {
  if (p1Near || nearFirst.length !== 4) return [...nearFirst];
  const [nearLeft, nearRight, farRight, farLeft] = nearFirst;
  return [farLeft, farRight, nearRight, nearLeft];
}
