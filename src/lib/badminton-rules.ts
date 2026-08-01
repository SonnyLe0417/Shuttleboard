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
  { id: "15", label: "15 · Best of 3", target: 15, cap: 20, decidingPoint: false, bestOf: 3 },
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

export function isMatchPoint(score: [number, number], r: MatchRules): boolean {
  if (isGameOver(score, r)) return false;
  const high = Math.max(score[0], score[1]);
  const low = Math.min(score[0], score[1]);
  if (r.decidingPoint) return high >= r.target - 1;
  return high >= r.target - 1 && (high - low >= 1 || high >= r.cap - 1);
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
