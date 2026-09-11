/** Normalize a result for its viewer without changing the saved match. */
export function matchForPlayer<T extends Record<string, any>>(match: T, userId: string): T {
  if (!match.team_b_user_ids?.includes(userId) || match.team_a_user_ids?.includes(userId))
    return match;
  return {
    ...match,
    team_a_names: match.team_b_names,
    team_b_names: match.team_a_names,
    team_a_user_ids: match.team_b_user_ids,
    team_b_user_ids: match.team_a_user_ids,
    games_won_a: match.games_won_b,
    games_won_b: match.games_won_a,
    games: (match.games ?? []).map((game: { a: number; b: number }) => ({ a: game.b, b: game.a })),
    winner: match.winner === "A" ? "B" : match.winner === "B" ? "A" : null,
  };
}

export function isCompletedMatch(match: { status?: string; winner?: string | null }) {
  return match.status !== "abandoned" && (match.winner === "A" || match.winner === "B");
}

export function levelForXp(xp: number) {
  const thresholds = [0, 100, 250, 500, 850, 1300, 1850, 2500];
  const level = thresholds.filter((threshold) => xp >= threshold).length;
  return Math.max(1, level + (xp >= 2500 ? Math.floor((xp - 2500) / 700) : 0));
}

export function levelBounds(xp: number) {
  const thresholds = [0, 100, 250, 500, 850, 1300, 1850, 2500];
  const level = levelForXp(xp);
  const start = thresholds[level - 1] ?? 2500 + (level - 8) * 700;
  const end = thresholds[level] ?? start + 700;
  return { start, end, percent: Math.max(0, Math.min(100, ((xp - start) / (end - start)) * 100)) };
}

export function levelName(level: number) {
  return (
    ["New Player", "Rally Builder", "Match Player", "Consistent Competitor"][level - 1] ??
    "Court Leader"
  );
}
