export type DashboardMatch = {
  id: string;
  mode: "singles" | "doubles";
  format?: string;
  winner: "A" | "B" | null;
  team_a_names: string[];
  team_b_names: string[];
  games: Array<{ a: number; b: number }>;
  started_at: string;
  finished_at?: string | null;
};
export type DashboardGoal = { title: string; target: number; progress: number; unit: string };
export type DashboardPreferences = {
  layout?: "compact" | "balanced" | "stats-heavy";
  coaching_tone?: "friendly" | "competitive" | "technical" | "blunt";
  terminology?: { game?: string; set?: string; rally?: string; match?: string };
  goal?: DashboardGoal;
};
export type DashboardCoreData = {
  profile: {
    display_name: string | null;
    handle: string | null;
    avatar_url: string | null;
    home_court: string | null;
  } | null;
  dashboard: DashboardPreferences;
  recentMatches: DashboardMatch[];
};
export type DashboardSummaryData = {
  stats: ReturnType<typeof dashboardStats>;
  weekMatchCount: number;
  hasMatches: boolean;
  activeQuest: {
    id: string;
    title: string;
    description: string;
    progress: number;
    target_value: number;
    status: string;
    ends_at: string;
  } | null;
  progress: { level_name: string; total_xp: number; current_level: number; current_streak: number };
  insight: { label: string; description: string; confidence?: string } | null;
};
/** Browser-local Monday serialized as an instant, independent of server timezone. */
export function localWeekStart(now = new Date()) {
  const start = new Date(now);
  start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}
/** Preserve the existing latest-100 formulas, including the dashboard's decider definition. */
export function dashboardStats(matches: Array<Pick<DashboardMatch, "winner" | "games">>) {
  const finished = matches.filter((m) => m.winner);
  let wins = 0,
    margin = 0,
    games = 0,
    decisiveGames = 0,
    deciderWins = 0;
  for (const m of finished) {
    const won = m.winner === "A";
    wins += won ? 1 : 0;
    if (m.games.length >= 3) {
      decisiveGames++;
      if (m.games[m.games.length - 1]?.a > m.games[m.games.length - 1]?.b === won) deciderWins++;
    }
    for (const g of m.games) {
      margin += Math.abs(g.a - g.b);
      games++;
    }
  }
  let streak = 0;
  for (const m of finished) {
    if (m.winner === "A") streak++;
    else break;
  }
  return {
    wins,
    losses: Math.max(0, finished.length - wins),
    winRate: finished.length ? Math.round((wins / finished.length) * 100) : 0,
    streak,
    avgMargin: games ? (margin / games).toFixed(1) : "0.0",
    decisiveGames,
    deciderWins,
  };
}
export function dashboardLevelName(level: number) {
  return (
    (
      {
        1: "New Player",
        2: "Rally Builder",
        3: "Match Player",
        4: "Consistent Competitor",
        5: "Court Leader",
      } as Record<number, string>
    )[level] ?? `Level ${level}`
  );
}
