// Preset scoring rules for a single game.
export type PresetId = "21" | "15" | "11" | "golden";

export interface MatchRules {
  id: PresetId;
  label: string;
  target: number;
  cap: number; // hard cap where the game ends regardless of margin
  decidingPoint: boolean; // true = no 2-pt margin needed (golden point)
  bestOf: 1 | 3 | 5;
}

export const PRESETS: MatchRules[] = [
  { id: "21", label: "21 · Best of 3", target: 21, cap: 30, decidingPoint: false, bestOf: 3 },
  // BWF 3x15: two clear points from 14-all, and the 21st point wins at 20-all.
  { id: "15", label: "15 · Best of 3", target: 15, cap: 21, decidingPoint: false, bestOf: 3 },
  { id: "11", label: "11 · Best of 3", target: 11, cap: 15, decidingPoint: false, bestOf: 3 },
  {
    id: "golden",
    label: "Golden Point · Single",
    target: 21,
    cap: 21,
    decidingPoint: true,
    bestOf: 1,
  },
];

export function findPreset(id: PresetId): MatchRules {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

export function isGameOver(score: [number, number], r: MatchRules): boolean {
  const high = Math.max(score[0], score[1]);
  const low = Math.min(score[0], score[1]);
  if (r.decidingPoint) return high >= r.target;
  return (high >= r.target && high - low >= 2) || high >= r.cap;
}

/** Returns 0/1 for game winner, or null if not over. */
export function gameWinner(score: [number, number], r: MatchRules): 0 | 1 | null {
  if (!isGameOver(score, r)) return null;
  return score[0] > score[1] ? 0 : 1;
}

/** Returns 0/1 for match winner given games-won so far, or null. */
export function matchWinner(games: [number, number], r: MatchRules): 0 | 1 | null {
  const needed = Math.ceil(r.bestOf / 2);
  if (games[0] >= needed) return 0;
  if (games[1] >= needed) return 1;
  return null;
}

/** The last game a match can need; best of 3 means game 3. */
export function isDecidingGame(gameNumber: number, r: MatchRules): boolean {
  return gameNumber === r.bestOf;
}

/** BWF: interval, and in the deciding game a change of ends, when the leader reaches 11 of 21. */
export function midGamePoint(r: MatchRules): number {
  return Math.ceil(r.target / 2);
}

export type PointCall = "game" | "match" | null;

/** "game" or "match" when this team wins the game (or the match) with the next rally. */
export function pointCall(
  score: [number, number],
  games: [number, number],
  team: 0 | 1,
  r: MatchRules,
): PointCall {
  if (isGameOver(score, r)) return null;
  const next: [number, number] = [score[0], score[1]];
  next[team] += 1;
  if (gameWinner(next, r) !== team) return null;
  return games[team] + 1 >= Math.ceil(r.bestOf / 2) ? "match" : "game";
}

export function isGamePoint(score: [number, number], r: MatchRules): boolean {
  return pointCall(score, [0, 0], 0, r) !== null || pointCall(score, [0, 0], 1, r) !== null;
}

export function isMatchPoint(
  score: [number, number],
  games: [number, number],
  r: MatchRules,
): boolean {
  return pointCall(score, games, 0, r) === "match" || pointCall(score, games, 1, r) === "match";
}

// Results scored before a preset changed may still be waiting to sync. The
// 15-point preset used to cap at 20, so 20-19 was a final score.
const EARLIER_CAPS: Partial<Record<PresetId, number[]>> = { "15": [20] };

/** A final game score is legal only if the game had not already ended one point earlier. */
export function isLegalGameScore(game: { a: number; b: number }, r: MatchRules): boolean {
  const high = Math.max(game.a, game.b);
  const low = Math.min(game.a, game.b);
  return high > low && isGameOver([high, low], r) && !isGameOver([high - 1, low], r);
}

/** Matches a saved result to the rules it was played under, when that is unambiguous. */
export function rulesForResult(
  pointsToWin: number,
  bestOf: number,
  format: string,
): MatchRules | null {
  const golden = /golden/i.test(format);
  const preset =
    PRESETS.find((p) => p.label === format) ??
    PRESETS.find((p) => p.target === pointsToWin && p.decidingPoint === golden);
  if (!preset || preset.target !== pointsToWin) return null;
  return { ...preset, bestOf: bestOf as MatchRules["bestOf"] };
}

/**
 * A game under rules we do not know: the winner reached the target, and only
 * a deuce takes a game past it, by at most two points.
 */
function finishesUnknownGame(game: { a: number; b: number }, target: number) {
  const high = Math.max(game.a, game.b);
  const low = Math.min(game.a, game.b);
  return high >= target && (high === target || high - low <= 2);
}

/** Tag on a manually logged match that ended when a player retired or conceded. */
export const RETIRED_TAG = "retired";

export interface ResultCheckOptions {
  bestOf: number;
  /** The winner must have won the match outright (offline uploads). */
  complete: boolean;
  /** Points to win a game, for a check when the rules are unknown. */
  pointsToWin?: number;
  /** A player retired or conceded during the last game, which stays unfinished. */
  retired?: boolean;
}

/**
 * Explains why a finished result cannot have happened, or returns null. With
 * `complete`, the winner must also have won the match outright; otherwise a
 * shortened match is allowed as long as the winner won more games. Without
 * rules, each game must still reach the target. After a retirement the last
 * game can stop at any score and the winner is the player who did not retire.
 */
export function matchResultProblem(
  games: ReadonlyArray<{ a: number; b: number }>,
  winner: "A" | "B" | null,
  r: MatchRules | null,
  options: ResultCheckOptions,
): string | null {
  if (!games.length) return "a finished match needs at least one game.";
  const needed = Math.ceil(options.bestOf / 2);
  const won: [number, number] = [0, 0];
  for (const [index, game] of games.entries()) {
    if (Math.max(...won) >= needed) {
      return `game ${index + 1} was played after the match was already decided.`;
    }
    if (options.retired && index === games.length - 1) break;
    if (game.a === game.b) return `game ${index + 1} is tied ${game.a}-${game.b}.`;
    const legal = r
      ? isLegalGameScore(game, r) ||
        (EARLIER_CAPS[r.id] ?? []).some((cap) => isLegalGameScore(game, { ...r, cap }))
      : options.pointsToWin === undefined || finishesUnknownGame(game, options.pointsToWin);
    if (!legal) {
      const target = r?.target ?? options.pointsToWin;
      return `game ${index + 1} (${game.a}-${game.b}) is not a finished ${target}-point game.`;
    }
    won[game.a > game.b ? 0 : 1] += 1;
  }
  if (options.retired) return winner ? null : "a retired match still needs a winner.";
  const decided = won[0] >= needed ? "A" : won[1] >= needed ? "B" : null;
  if (options.complete && !decided) return "the match is not finished.";
  const leader = decided ?? (won[0] > won[1] ? "A" : won[1] > won[0] ? "B" : null);
  if (!leader) return "neither side won more games.";
  if (winner !== leader) {
    return `the winner must be team ${leader}, who won ${won[leader === "A" ? 0 : 1]} of ${games.length} games.`;
  }
  return null;
}
