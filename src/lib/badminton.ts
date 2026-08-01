export const COURT = {
  singlesSideline: 0.087,
  shortServiceY: 0.354,
  doublesLongServiceY: 0.076,
  center: 0.5,
} as const;

export type GameMode = "singles" | "doubles";
export type Side = "left" | "right";

export interface MatchState {
  score: [number, number];
  server: 0 | 1;
  mode: GameMode;
  declaredSide: Side;
  serveCheck: boolean;
  nearSide: boolean;
  names: [string, string];
  log: string[];
  history: MatchSnapshot[];
}

export interface MatchSnapshot {
  score: [number, number];
  server: 0 | 1;
  mode: GameMode;
  declaredSide: Side;
  serveCheck: boolean;
  nearSide: boolean;
  names: [string, string];
  log: string[];
}

export function correctServeSide(score: number): Side {
  return score % 2 === 0 ? "right" : "left";
}

export function receiverSide(serverScore: number): Side {
  return correctServeSide(serverScore) === "right" ? "left" : "right";
}

export function isGameOver(score: [number, number]): boolean {
  const high = Math.max(score[0], score[1]);
  const low = Math.min(score[0], score[1]);
  return high >= 21 && (high - low >= 2 || high === 30);
}

export function winnerText(score: [number, number], names: [string, string]): string {
  if (!isGameOver(score)) return "";
  return score[0] > score[1] ? names[0] : names[1];
}

export function isMatchPoint(score: [number, number]): boolean {
  const high = Math.max(score[0], score[1]);
  const low = Math.min(score[0], score[1]);
  return high >= 20 && !isGameOver(score) && high - low >= 1;
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

  const side = receiverSide(serverScore);
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
  const side = receiverSide(serverScore);
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
  lineMarginPercent: number;
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
  const nearestAxis = Math.abs(xResult.distance) <= Math.abs(yResult.distance) ? "x" : "y";
  const nearest = nearestAxis === "x" ? xResult : yResult;
  const labelKey = `${nearestAxis}${nearest.edge === "min" ? "Min" : "Max"}`;
  const lineMargin = nearest.distance;
  const absoluteMargin = Math.abs(lineMargin);

  const modeText = serveCheck
    ? `Serve must land diagonally in the ${receiverSide(serverScore)} service court.`
    : `${mode === "singles" ? "Singles" : "Doubles"} rally boundary is active.`;

  return {
    isIn,
    modeText,
    lineMargin,
    absoluteMargin,
    lineMarginPercent: Number((absoluteMargin * 100).toFixed(2)),
    nearestLine: box.labels[labelKey as keyof LandingBox["labels"]],
    closeLine: absoluteMargin < 0.025,
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

export function formatCall(x: number, y: number, verdict: LandingVerdict): string {
  const xText = `${Math.round(x * 100)}%`;
  const yText = `${Math.round(y * 100)}%`;
  const marginText =
    verdict.lineMarginPercent <= 6
      ? ` Nearest line: ${verdict.nearestLine}, ${verdict.lineMarginPercent}% court margin.`
      : "";
  return `${verdict.isIn ? "In" : "Out"} — ${verdict.modeText} Marked at ${xText} width and ${yText} length.${marginText}`;
}
