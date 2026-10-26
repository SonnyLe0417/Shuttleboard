import type { AnalysisRally } from "./analysis-results";
import type { GameMode } from "./badminton";
import type { MatchAnnotation } from "./match-annotation";
import { formatGameScores, replayMatch } from "./match-timeline";
import type { TrackNetPoint } from "./tracknet-client";
import { buildTrackNetRallies } from "./tracknet-rallies";
import { type VideoMatchOptions, resolveVideoMatch } from "./video-match";

export interface RallyEvaluation {
  index: number;
  start: number;
  end: number | null;
  annotatedWinner: "p1" | "p2";
  landingVisible: boolean;
  /** The app's rallies that ended between this serve and the next one. */
  found: Array<Pick<AnalysisRally, "id" | "t" | "winner" | "countsTowardScore" | "decidedBy">>;
  /** The first proposal's winner matches the annotation. */
  winnerRight: boolean | null;
  /** Seconds from the annotated rally end to the app's rally time. */
  timing: number | null;
}

export interface AnnotationEvaluation {
  rallies: RallyEvaluation[];
  summary: {
    annotated: number;
    found: number;
    missed: number;
    extra: number;
    winnersRight: number;
    winnersWrong: number;
    countedWrong: number;
    pending: number;
    /** Rallies found / annotated rallies. */
    recall: number;
    /** Right winners / rallies found. */
    winnerAccuracy: number;
    /** Largest gap, in seconds, between an annotated rally end and the app's. */
    largestTiming: number;
  };
  games: { annotated: string; app: string; appWinner: string | null; match: boolean };
}

/**
 * Scores the production pipeline against a hand-labelled match: every
 * annotated rally owns the window from its serve to the next serve, and the
 * app should end exactly one rally in it, with the same winner.
 */
export function evaluateAgainstAnnotation(
  annotation: MatchAnnotation,
  points: TrackNetPoint[],
  homography: number[],
  options: VideoMatchOptions & { mode?: GameMode } = {},
): AnnotationEvaluation {
  const built = buildTrackNetRallies(points, homography, { mode: options.mode });
  const match = resolveVideoMatch(built, {
    initialNear: options.initialNear ?? annotation.initialNear,
    ...options,
  });

  const claimed = new Set<number>();
  const rallies = annotation.rallies.map((rally): RallyEvaluation => {
    const until = rally.nextServe ?? Number.POSITIVE_INFINITY;
    const found = match.rallies.filter((item) => item.t >= rally.start && item.t < until);
    found.forEach((item) => claimed.add(item.id));
    const first = found[0];
    return {
      index: rally.index,
      start: rally.start,
      end: rally.end,
      annotatedWinner: rally.winner,
      landingVisible: rally.landingVisible,
      found: found.map(({ id, t, winner, countsTowardScore, decidedBy }) => ({
        id,
        t,
        winner,
        countsTowardScore,
        decidedBy,
      })),
      winnerRight: first ? first.winner === rally.winner : null,
      timing: first && rally.end !== null ? first.t - rally.end : null,
    };
  });

  const withProposal = rallies.filter((rally) => rally.found.length > 0);
  const winnersRight = withProposal.filter((rally) => rally.winnerRight).length;
  const countedWrong = withProposal.filter(
    (rally) => !rally.winnerRight && rally.found[0].countsTowardScore !== false,
  ).length;
  const outside = match.rallies.filter((item) => !claimed.has(item.id)).length;
  const duplicates = rallies.reduce(
    (total, rally) => total + Math.max(0, rally.found.length - 1),
    0,
  );
  const app = match.timeline;
  const annotatedGames = formatGameScores(
    replayMatch(annotation.rallies, { rules: options.rules, initialNear: annotation.initialNear })
      .games,
  );
  return {
    rallies,
    summary: {
      annotated: rallies.length,
      found: withProposal.length,
      missed: rallies.length - withProposal.length,
      extra: duplicates + outside,
      winnersRight,
      winnersWrong: withProposal.length - winnersRight,
      countedWrong,
      pending: match.pending,
      recall: rallies.length ? withProposal.length / rallies.length : 0,
      winnerAccuracy: withProposal.length ? winnersRight / withProposal.length : 0,
      largestTiming: rallies.reduce(
        (largest, rally) => Math.max(largest, Math.abs(rally.timing ?? 0)),
        0,
      ),
    },
    games: {
      annotated: annotatedGames,
      app: formatGameScores(app.games),
      appWinner: app.matchWinner,
      match: annotatedGames === formatGameScores(app.games),
    },
  };
}
