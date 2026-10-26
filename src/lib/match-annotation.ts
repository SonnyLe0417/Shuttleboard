// Hand-labelled match videos (tests/fixtures/*.json) are the scoring ground truth.
export type PlayerId = "p1" | "p2";
export type CourtEnd = "near" | "far";
/** How the rally ended, from the winner's point of view. */
export type RallyEnding = "in" | "out" | "net" | "missed" | "unknown";

export interface AnnotatedRally {
  index: number;
  start: number;
  /** Null for a rally the annotator skipped; only its window is known. */
  end: number | null;
  nextServe: number | null;
  winner: PlayerId;
  ending: RallyEnding;
  /** False when the annotator could not see the landing on the video. */
  landingVisible: boolean;
  /** Not in the annotator's list; deduced from the serve times and the result. */
  inferred: boolean;
  note: string;
}

export interface AnnotatedSideChange {
  at: number;
  near: PlayerId;
}

/** The previous rally's next serve does not match the next annotated rally. */
export interface AnnotationGap {
  afterIndex: number;
  expectedStart: number;
  actualStart: number;
}

export interface MatchAnnotation {
  video: string;
  initialNear: PlayerId;
  sideChanges: AnnotatedSideChange[];
  rallies: AnnotatedRally[];
  gaps: AnnotationGap[];
}

const GAP_TOLERANCE_SECONDS = 0.5;

/** Accepts seconds, "m:ss" or "h:mm:ss". "N/A" and blanks mean no time. */
export function parseAnnotationTime(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : NaN;
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return NaN;
  const text = value.trim();
  if (!text || /^n\/?a$/i.test(text)) return null;
  if (!/^\d+(:[0-5]?\d){0,2}(\.\d+)?$/.test(text)) return NaN;
  return text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

export function classifyRallyEnding(how: string): RallyEnding {
  const text = how.trim().toLowerCase();
  if (/into the net|go over the net|went over the net|not over the net/.test(text)) return "net";
  if (/\bout\b/.test(text)) return "out";
  if (/\bmissed\b/.test(text)) return "missed";
  if (/^in\b/.test(text)) return "in";
  return "unknown";
}

/** "closer to the camera, bottom of the picture" → near. */
export function endFromDescription(description: unknown): CourtEnd | null {
  if (typeof description !== "string") return null;
  const text = description.toLowerCase();
  if (/closer|bottom|near/.test(text)) return "near";
  if (/farther|further|top|far/.test(text)) return "far";
  return null;
}

export function otherPlayer(player: PlayerId): PlayerId {
  return player === "p1" ? "p2" : "p1";
}

/** Where the shuttle came down, given who won and how. */
export function annotatedLanding(
  rally: Pick<AnnotatedRally, "winner" | "ending">,
  near: PlayerId,
): { end: CourtEnd; inCourt: boolean } {
  const loser = otherPlayer(rally.winner);
  const endOf = (player: PlayerId): CourtEnd => (player === near ? "near" : "far");
  // An out shot crosses the net and lands beyond the winner's lines. A net
  // fault falls back on the hitter's side; every other ending lands in the
  // loser's court.
  if (rally.ending === "out") return { end: endOf(rally.winner), inCourt: false };
  return { end: endOf(loser), inCourt: true };
}

export function nearPlayerAt(annotation: MatchAnnotation, time: number): PlayerId {
  let near = annotation.initialNear;
  for (const change of annotation.sideChanges) if (time >= change.at) near = change.near;
  return near;
}

function requireWinner(value: unknown, label: string): PlayerId {
  if (value !== "p1" && value !== "p2") throw new Error(`${label}.winner must be p1 or p2.`);
  return value;
}

function requireTime(value: unknown, label: string): number {
  const parsed = parseAnnotationTime(value);
  if (parsed === null || !Number.isFinite(parsed)) throw new Error(`${label} is not a time.`);
  return parsed;
}

export function loadMatchAnnotation(raw: unknown): MatchAnnotation {
  if (!raw || typeof raw !== "object") throw new Error("Annotation must be an object.");
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.points) || !value.points.length) {
    throw new Error("Annotation needs at least one point.");
  }

  const p1End = endFromDescription(value.player1);
  const p2End = endFromDescription(value.player2);
  if (p1End && p2End && p1End === p2End) throw new Error("Both players start at the same end.");
  const initialNear: PlayerId = p1End === "far" || p2End === "near" ? "p2" : "p1";

  const sideChanges = (Array.isArray(value.sideChanges) ? value.sideChanges : []).map(
    (change: Record<string, unknown>, index): AnnotatedSideChange => {
      const at = requireTime(change.fromSecond, `sideChanges[${index}].fromSecond`);
      const near =
        endFromDescription(change.player1) === "near" ||
        endFromDescription(change.player2) === "far"
          ? "p1"
          : "p2";
      return { at, near };
    },
  );

  const annotated = value.points.map((point: Record<string, unknown>, index): AnnotatedRally => {
    const label = `points[${index}]`;
    const winner = requireWinner(point.winner, label);
    const start = requireTime(point.fromSecond, `${label}.fromSecond`);
    const end = requireTime(point.toSecond, `${label}.toSecond`);
    const nextServe = parseAnnotationTime(point.nextServeSecond);
    if (nextServe !== null && !Number.isFinite(nextServe)) {
      throw new Error(`${label}.nextServeSecond is not a time.`);
    }
    if (end < start) throw new Error(`${label} ends before it starts.`);
    if (nextServe !== null && nextServe < end) throw new Error(`${label} serves before it ends.`);
    const how = typeof point.how === "string" ? point.how : "";
    const note = [point.description, point.notes]
      .filter((text): text is string => typeof text === "string" && text.trim() !== "")
      .join(" ");
    return {
      index,
      start,
      end,
      nextServe,
      winner,
      ending: classifyRallyEnding(how),
      landingVisible: !/cannot see/i.test(note),
      inferred: false,
      note,
    };
  });

  const deduced = (Array.isArray(value.unannotatedRallies) ? value.unannotatedRallies : []).map(
    (rally: Record<string, unknown>, index): AnnotatedRally => {
      const label = `unannotatedRallies[${index}]`;
      const start = requireTime(rally.fromSecond, `${label}.fromSecond`);
      const nextServe = requireTime(rally.beforeSecond, `${label}.beforeSecond`);
      if (nextServe <= start) throw new Error(`${label} has an empty window.`);
      return {
        index: -1,
        start,
        end: null,
        nextServe,
        winner: requireWinner(rally.winner, label),
        ending: "unknown",
        landingVisible: false,
        inferred: true,
        note: typeof rally.reason === "string" ? rally.reason : "",
      };
    },
  );

  const rallies = [...annotated, ...deduced]
    .sort((a, b) => a.start - b.start)
    .map((rally, index) => ({ ...rally, index }));

  const gaps: AnnotationGap[] = [];
  for (let i = 0; i + 1 < rallies.length; i++) {
    const current = rallies[i];
    const next = rallies[i + 1];
    if (next.start < (current.end ?? current.start)) {
      throw new Error(`The rally at ${next.start}s overlaps the one at ${current.start}s.`);
    }
    const expected = current.nextServe;
    if (expected !== null && Math.abs(expected - next.start) > GAP_TOLERANCE_SECONDS) {
      gaps.push({ afterIndex: i, expectedStart: expected, actualStart: next.start });
    }
  }

  return {
    video: typeof value.video === "string" ? value.video : "",
    initialNear,
    sideChanges,
    rallies,
    gaps,
  };
}
