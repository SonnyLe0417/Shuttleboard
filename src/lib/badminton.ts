// BWF court in metres. Normalized court x spans the doubles width and y the
// full length, with y=0 at the far back boundary and y=1 at the near one.
export const COURT_LENGTH_M = 13.4;
export const COURT_WIDTH_M = 6.1;
const SINGLES_ALLEY_M = 0.46;
const SHORT_SERVICE_FROM_NET_M = 1.98;
const DOUBLES_LONG_SERVICE_FROM_BACK_M = 0.76;
const CLOSE_LINE_M = 0.15;

export const COURT = {
  singlesSideline: SINGLES_ALLEY_M / COURT_WIDTH_M,
  shortServiceY: (COURT_LENGTH_M / 2 - SHORT_SERVICE_FROM_NET_M) / COURT_LENGTH_M,
  doublesLongServiceY: DOUBLES_LONG_SERVICE_FROM_BACK_M / COURT_LENGTH_M,
  center: 0.5,
} as const;

export type GameMode = "singles" | "doubles";
export type Side = "left" | "right";
export type CourtEnd = "near" | "far";

/** The service court a server stands in, named from their own point of view. */
export function correctServeSide(score: number): Side {
  return score % 2 === 0 ? "right" : "left";
}

/** The receiver stands diagonally opposite, in the court with the same name. */
export function receiverCourt(serverScore: number): Side {
  return correctServeSide(serverScore);
}

/**
 * Where a player's named court appears in the picture. Players at the near end
 * face away from the camera; players at the far end face it, so their right is
 * the left of the picture.
 */
export function imageSide(court: Side, atNearEnd: boolean): Side {
  if (atNearEnd) return court;
  return court === "right" ? "left" : "right";
}

export function courtEnd(y: number): CourtEnd {
  return y > COURT.center ? "near" : "far";
}

/**
 * Which end a rally landing favours. A shuttle that lands in court, or a net
 * fault that drops on the hitter's own side, loses the rally for the player at
 * that end. An out shot was hit there by the opponent, so that player wins.
 */
export function rallyLanding(x: number, y: number, mode: GameMode) {
  const end = courtEnd(y);
  const isIn = inNormalCourt(x, y, mode);
  const other: CourtEnd = end === "near" ? "far" : "near";
  return { end, isIn, winnerEnd: isIn ? other : end };
}

export function inNormalCourt(x: number, y: number, mode: GameMode): boolean {
  const insideLength = y >= 0 && y <= 1;
  const insideWidth =
    mode === "singles"
      ? x >= COURT.singlesSideline && x <= 1 - COURT.singlesSideline
      : x >= 0 && x <= 1;
  return insideLength && insideWidth;
}

export function inServiceCourt(
  x: number,
  y: number,
  mode: GameMode,
  nearSide: boolean,
  serverScore: number,
): boolean {
  const targetNear = !nearSide;
  const inTargetHalf = targetNear ? y >= COURT.center : y <= COURT.center;
  if (!inTargetHalf) return false;

  const side = imageSide(receiverCourt(serverScore), targetNear);
  const inDiagonalSide = side === "right" ? x >= COURT.center : x <= COURT.center;
  const inWidth =
    mode === "singles"
      ? x >= COURT.singlesSideline && x <= 1 - COURT.singlesSideline
      : x >= 0 && x <= 1;

  if (!inDiagonalSide || !inWidth) return false;

  if (targetNear) {
    const beyondShortService = y >= 1 - COURT.shortServiceY;
    const insideLongService = mode === "doubles" ? y <= 1 - COURT.doublesLongServiceY : y <= 1;
    return beyondShortService && insideLongService;
  }

  const beyondShortService = y <= COURT.shortServiceY;
  const insideLongService = mode === "doubles" ? y >= COURT.doublesLongServiceY : y >= 0;
  return beyondShortService && insideLongService;
}

export interface LandingBox {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  labels: {
    xMin: string;
    xMax: string;
    yMin: string;
    yMax: string;
  };
}

export function activeLandingBox(
  mode: GameMode,
  serveCheck: boolean,
  nearSide: boolean,
  serverScore: number,
): LandingBox {
  const widthMin = mode === "singles" ? COURT.singlesSideline : 0;
  const widthMax = mode === "singles" ? 1 - COURT.singlesSideline : 1;

  if (!serveCheck) {
    return {
      xMin: widthMin,
      xMax: widthMax,
      yMin: 0,
      yMax: 1,
      labels: {
        xMin: "left sideline",
        xMax: "right sideline",
        yMin: "far back line",
        yMax: "near back line",
      },
    };
  }

  const targetNear = !nearSide;
  const side = imageSide(receiverCourt(serverScore), targetNear);
  const xMin = side === "right" ? COURT.center : widthMin;
  const xMax = side === "right" ? widthMax : COURT.center;
  const yMin = targetNear
    ? 1 - COURT.shortServiceY
    : mode === "doubles"
      ? COURT.doublesLongServiceY
      : 0;
  const yMax = targetNear
    ? mode === "doubles"
      ? 1 - COURT.doublesLongServiceY
      : 1
    : COURT.shortServiceY;

  return {
    xMin,
    xMax,
    yMin,
    yMax,
    labels: {
      xMin: side === "right" ? "center service line" : "left sideline",
      xMax: side === "right" ? "right sideline" : "center service line",
      yMin: targetNear
        ? "short service line"
        : mode === "doubles"
          ? "doubles long service line"
          : "far back line",
      yMax: targetNear
        ? mode === "doubles"
          ? "doubles long service line"
          : "near back line"
        : "short service line",
    },
  };
}

export interface LandingVerdict {
  isIn: boolean;
  modeText: string;
  lineMargin: number;
  absoluteMargin: number;
  /** Distance to the nearest line in centimetres on the real court. */
  lineMarginCm: number;
  nearestLine: string;
  closeLine: boolean;
}

export function landingVerdict(
  x: number,
  y: number,
  mode: GameMode,
  serveCheck: boolean,
  nearSide: boolean,
  serverScore: number,
): LandingVerdict {
  const isIn = serveCheck
    ? inServiceCourt(x, y, mode, nearSide, serverScore)
    : inNormalCourt(x, y, mode);
  const box = activeLandingBox(mode, serveCheck, nearSide, serverScore);

  const xResult = signedBoundaryDistance(x, box.xMin, box.xMax);
  const yResult = signedBoundaryDistance(y, box.yMin, box.yMax);
  // Compare in metres: one normalized unit is 6.10 m across but 13.40 m long.
  // Outside the court, the violated boundary is always the nearest one.
  const xMetres = xResult.distance * COURT_WIDTH_M;
  const yMetres = yResult.distance * COURT_LENGTH_M;
  const nearestAxis = xMetres <= yMetres ? "x" : "y";
  const nearest = nearestAxis === "x" ? xResult : yResult;
  const nearestMetres = Math.abs(nearestAxis === "x" ? xMetres : yMetres);
  const labelKey = `${nearestAxis}${nearest.edge === "min" ? "Min" : "Max"}`;
  const lineMargin = nearest.distance;
  const absoluteMargin = Math.abs(lineMargin);

  const modeText = serveCheck
    ? `Serve must land diagonally in the receiver's ${receiverCourt(serverScore)} service court.`
    : `${mode === "singles" ? "Singles" : "Doubles"} rally boundary is active.`;

  return {
    isIn,
    modeText,
    lineMargin,
    absoluteMargin,
    lineMarginCm: Math.round(nearestMetres * 100),
    nearestLine: box.labels[labelKey as keyof LandingBox["labels"]],
    closeLine: nearestMetres < CLOSE_LINE_M,
  };
}

function signedBoundaryDistance(value: number, min: number, max: number) {
  if (value < min) return { distance: value - min, edge: "min" as const };
  if (value > max) return { distance: max - value, edge: "max" as const };
  const minDistance = value - min;
  const maxDistance = max - value;
  return minDistance <= maxDistance
    ? { distance: minDistance, edge: "min" as const }
    : { distance: maxDistance, edge: "max" as const };
}
