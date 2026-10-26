import {
  type AnalysisRally,
  type AnalysisScore,
  type RallyDecision,
  formatAnalysisTime,
} from "./analysis-results";
import type { CourtEnd } from "./badminton";
import { type MatchRules, type PresetId, findPreset } from "./badminton-rules";
import { type PlayerId, parseAnnotationTime } from "./match-annotation";
import {
  type MatchTimeline,
  type TimelineState,
  advanceTimeline,
  createTimeline,
} from "./match-timeline";

export interface SideChange {
  /** Video time (seconds) from which `near` is at the near end. */
  at: number;
  near: PlayerId;
}

export interface VideoMatchOptions {
  rules?: MatchRules;
  /** Who is at the near end (bottom of the picture) when the video starts. */
  initialNear?: PlayerId;
  /**
   * Changes of ends marked on the video. Without them, ends follow the score:
   * after each game and at 11 in the deciding game.
   */
  sideChanges?: ReadonlyArray<SideChange>;
}

/** What the reviewer tells the page about the match on the video. */
export interface VideoMatchSettings {
  presetId: PresetId;
  initialNear: PlayerId;
  /** Marked changes of ends; empty means "follow the score". */
  sideChanges: SideChange[];
}

export const DEFAULT_VIDEO_MATCH_SETTINGS: VideoMatchSettings = {
  presetId: "21",
  initialNear: "p1",
  sideChanges: [],
};

export function videoMatchOptions(settings: VideoMatchSettings): VideoMatchOptions {
  return {
    rules: findPreset(settings.presetId),
    initialNear: settings.initialNear,
    sideChanges: settings.sideChanges,
  };
}

/** "14:22, 31:05" → the players swap ends at each time, starting from the initial ends. */
export function parseSideChanges(text: string, initialNear: PlayerId): SideChange[] | null {
  const times = text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(parseAnnotationTime);
  if (times.some((time) => time === null || !Number.isFinite(time))) return null;
  let near = initialNear;
  return (times as number[])
    .sort((a, b) => a - b)
    .map((at) => {
      near = other(near);
      return { at, near };
    });
}

export function formatSideChanges(changes: readonly SideChange[]) {
  return changes.map((change) => formatAnalysisTime(change.at)).join(", ");
}

export interface VideoMatch {
  /** The rallies in time order, with winners attributed to players. */
  rallies: AnalysisRally[];
  /**
   * Games, ends and the result from the best reading of every rally with
   * evidence, including suggestions still waiting for review.
   */
  timeline: MatchTimeline;
  /** Score of the game in progress (or the final game once the match is over). */
  score: AnalysisScore;
  /** Points per game from confirmed rallies only. */
  confirmed: AnalysisScore[];
  /** Rallies in the reading above that still need a reviewer. */
  pending: number;
  /** Who is at the near end now, after the last rally, honouring marked changes of ends. */
  near: PlayerId;
}

const other = (player: PlayerId): PlayerId => (player === "p1" ? "p2" : "p1");
const name = (player: PlayerId) => (player === "p1" ? "Player 1" : "Player 2");

/**
 * The rally list is the record; winners, games and ends are derived from it on
 * every change, so confirming or correcting one rally re-scores everything
 * after it. A landing gives the rally to the player who did not lose it at
 * that end; the next serve gives it to whoever serves, since the winner of a
 * rally serves the next one.
 */
export function resolveVideoMatch(
  rallies: readonly AnalysisRally[],
  options: VideoMatchOptions = {},
): VideoMatch {
  const initialNear = options.initialNear ?? "p1";
  const marked = options.sideChanges?.length
    ? [...options.sideChanges].sort((a, b) => a.at - b.at)
    : null;
  const nearAt = (state: TimelineState, time: number) => {
    if (!marked) return state.near;
    let near = initialNear;
    for (const change of marked) if (time >= change.at) near = change.near;
    return near;
  };

  const ordered = [...rallies].sort((a, b) => a.t - b.t || a.id - b.id);
  const inPlay = ordered.filter((rally) => !rally.excluded);
  // Games and ends follow the best reading of every rally with evidence, so a
  // rally waiting for review neither delays the change of ends (and with it
  // the players on every later rally) nor moves a game into the next one.
  // Only confirmed rallies add to the confirmed tallies.
  let state = createTimeline({ rules: options.rules, initialNear });
  const steps: MatchTimeline["steps"] = [];
  const confirmed: AnalysisScore[] = [];
  let pending = 0;
  const resolved = ordered.map((rally): AnalysisRally => {
    const near = nearAt(state, rally.t);
    if (rally.excluded) {
      return {
        ...rally,
        near,
        countsTowardScore: false,
        needsReview: false,
        reviewReasons: [],
        aiNote: "Not a rally.",
        decidedBy: undefined,
        game: undefined,
        scoreAfter: undefined,
        afterMatch: false,
      };
    }
    const owner = (end: CourtEnd) => (end === "near" ? near : other(near));
    const landingWinner =
      rally.landingSeen !== false && rally.landingEnd
        ? rally.inBounds
          ? other(owner(rally.landingEnd))
          : owner(rally.landingEnd)
        : null;
    const visionWinner = rally.aiWinnerEnd ? owner(rally.aiWinnerEnd) : null;
    const seenWinner = visionWinner ?? landingWinner;
    const following = inPlay[inPlay.indexOf(rally) + 1];
    const serveWinner = nextServer(state, rally, following, nearAt);
    const seenBy = visionWinner ? "vision check" : "landing";

    const reasons = [...(rally.reviewReasons ?? [])];
    let winner = rally.winner;
    let counts = rally.countsTowardScore !== false;
    let decidedBy: RallyDecision | undefined;
    if (rally.reviewerWinnerEnd) {
      winner = owner(rally.reviewerWinnerEnd);
      decidedBy = "reviewer";
    } else if (rally.reviewerCall && landingWinner) {
      // The reviewer's own in/out call stands over the next serve.
      winner = landingWinner;
      decidedBy = "reviewer";
      counts = true;
      reasons.length = 0;
    } else if (seenWinner && serveWinner && seenWinner !== serveWinner) {
      // Clean or not, conflicting evidence goes to the reviewer.
      winner = rally.landingAmbiguous && !visionWinner ? serveWinner : seenWinner;
      counts = false;
      reasons.push(
        `The ${seenBy} gives the rally to ${name(seenWinner)}, but ${name(serveWinner)} served next.`,
      );
    } else if (seenWinner) {
      winner = seenWinner;
      decidedBy = serveWinner ? `${seenBy} and next serve` : seenBy;
      // A line or net call that the next serve agrees with is settled.
      if (serveWinner && rally.landingAmbiguous) {
        counts = true;
        reasons.length = 0;
      }
    } else if (serveWinner) {
      winner = serveWinner;
      decidedBy = "next serve";
    }
    if (rally.reviewerCounts !== undefined) counts = rally.reviewerCounts;

    const evidence = decidedBy !== undefined || serveWinner !== null;
    const next = advanceTimeline(state, winner, evidence);
    state = next.state;
    steps.push(next.step);
    if (next.step.afterMatch) {
      counts = false;
      reasons.push("The match was already over.");
    } else if (next.step.counted) {
      const game = (confirmed[next.step.game - 1] ??= { p1: 0, p2: 0 });
      if (counts) game[winner]++;
      else pending++;
    }
    const needsReview = !counts && !next.step.afterMatch;
    const reviewed = rally.reviewerCounts !== undefined;
    return {
      ...rally,
      winner,
      near,
      countsTowardScore: counts,
      needsReview,
      reviewReasons: reasons,
      reviewStatus: reviewed
        ? rally.reviewStatus
        : needsReview
          ? "needs-review"
          : rally.reviewStatus === "needs-review"
            ? undefined
            : rally.reviewStatus,
      aiNote: needsReview || next.step.afterMatch ? reasons.join(" ") : rally.aiNote,
      decidedBy,
      game: next.step.game,
      scoreAfter: next.step.scoreAfter,
      afterMatch: next.step.afterMatch,
    };
  });

  const last = inPlay.at(-1);
  return {
    rallies: resolved,
    timeline: { ...state, steps },
    score: { ...state.score },
    confirmed,
    pending,
    near: nearAt(state, last ? last.t + 1 : 0),
  };
}

/**
 * Who served the following rally, read as the winner of this one. At a game
 * point both readings can be consistent (the far player won and ends changed,
 * or the near player won), and then the serve decides nothing.
 */
function nextServer(
  state: TimelineState,
  rally: AnalysisRally,
  following: AnalysisRally | undefined,
  nearAt: (state: TimelineState, time: number) => PlayerId,
): PlayerId | null {
  if (!following?.serveEnd || state.matchWinner) return null;
  const consistent = (["p1", "p2"] as const).filter((winner) => {
    const after = advanceTimeline(state, winner).state;
    const near = nearAt(after, following.startT ?? following.t);
    const server = following.serveEnd === "near" ? near : other(near);
    return server === winner;
  });
  return consistent.length === 1 && rally.t < (following.startT ?? following.t)
    ? consistent[0]
    : null;
}
