import {
  type MatchRules,
  PRESETS,
  gameWinner,
  isDecidingGame,
  matchWinner,
  midGamePoint,
} from "@/lib/badminton-rules";
import type { PlayerId } from "@/lib/match-annotation";

export interface PlayerScore {
  p1: number;
  p2: number;
}

export interface CompletedGameScore extends PlayerScore {
  winner: PlayerId;
}

export interface TimelineOptions {
  rules?: MatchRules;
  /** Who is at the end nearest the camera when the first game starts. */
  initialNear?: PlayerId;
}

export interface TimelineState {
  rules: MatchRules;
  game: number;
  score: PlayerScore;
  games: CompletedGameScore[];
  gamesWon: PlayerScore;
  near: PlayerId;
  server: PlayerId | null;
  matchWinner: PlayerId | null;
  /** The deciding game's mid-game change of ends has happened. */
  changedAtInterval: boolean;
}

export interface TimelineStep {
  game: number;
  /** Who was at the near end while this rally was played. */
  near: PlayerId;
  scoreBefore: PlayerScore;
  /** Game score straight after this rally, before a finished game resets. */
  scoreAfter: PlayerScore;
  counted: boolean;
  gameOver: boolean;
  /** Players changed ends straight after this rally. */
  changedEnds: boolean;
  /** The match was already decided, so this rally cannot score. */
  afterMatch: boolean;
}

export interface MatchTimeline extends TimelineState {
  steps: TimelineStep[];
}

const other = (player: PlayerId): PlayerId => (player === "p1" ? "p2" : "p1");

export function createTimeline(options: TimelineOptions = {}): TimelineState {
  return {
    rules: options.rules ?? PRESETS[0],
    game: 1,
    score: { p1: 0, p2: 0 },
    games: [],
    gamesWon: { p1: 0, p2: 0 },
    near: options.initialNear ?? "p1",
    server: null,
    matchWinner: null,
    changedAtInterval: false,
  };
}

/** Pure: returns the next state and what happened during this rally. */
export function advanceTimeline(
  state: TimelineState,
  winner: PlayerId,
  counted = true,
): { state: TimelineState; step: TimelineStep } {
  const base = {
    game: state.game,
    near: state.near,
    scoreBefore: { ...state.score },
    counted: false,
    gameOver: false,
    changedEnds: false,
  };
  if (state.matchWinner) {
    return { state, step: { ...base, scoreAfter: { ...state.score }, afterMatch: true } };
  }
  if (!counted) {
    return { state, step: { ...base, scoreAfter: { ...state.score }, afterMatch: false } };
  }

  const score = { ...state.score, [winner]: state.score[winner] + 1 };
  const step: TimelineStep = {
    ...base,
    scoreAfter: { ...score },
    counted: true,
    afterMatch: false,
  };
  const finished = gameWinner([score.p1, score.p2], state.rules);
  if (finished === null) {
    const changeAt = midGamePoint(state.rules);
    const reachedInterval =
      isDecidingGame(state.game, state.rules) &&
      !state.changedAtInterval &&
      Math.max(score.p1, score.p2) >= changeAt;
    step.changedEnds = reachedInterval;
    return {
      state: {
        ...state,
        score,
        server: winner,
        near: reachedInterval ? other(state.near) : state.near,
        changedAtInterval: state.changedAtInterval || reachedInterval,
      },
      step,
    };
  }

  const gameWinnerId: PlayerId = finished === 0 ? "p1" : "p2";
  const gamesWon = { ...state.gamesWon, [gameWinnerId]: state.gamesWon[gameWinnerId] + 1 };
  const decided = matchWinner([gamesWon.p1, gamesWon.p2], state.rules);
  step.gameOver = true;
  // Ends change after every game except the last one.
  step.changedEnds = decided === null;
  return {
    state: {
      ...state,
      game: decided === null ? state.game + 1 : state.game,
      score: decided === null ? { p1: 0, p2: 0 } : score,
      games: [...state.games, { ...score, winner: gameWinnerId }],
      gamesWon,
      near: decided === null ? other(state.near) : state.near,
      server: winner,
      matchWinner: decided === null ? null : decided === 0 ? "p1" : "p2",
      changedAtInterval: false,
    },
    step,
  };
}

export function replayMatch(
  rallies: ReadonlyArray<{ winner: PlayerId; counted?: boolean }>,
  options: TimelineOptions = {},
): MatchTimeline {
  let state = createTimeline(options);
  const steps: TimelineStep[] = [];
  for (const rally of rallies) {
    const next = advanceTimeline(state, rally.winner, rally.counted !== false);
    state = next.state;
    steps.push(next.step);
  }
  return { ...state, steps };
}

export function formatGameScores(games: ReadonlyArray<PlayerScore>) {
  return games.map((game) => `${game.p1}-${game.p2}`).join(", ");
}
