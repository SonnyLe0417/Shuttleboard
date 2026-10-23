// Synthetic content only. No real account data or credentials.
import { matchForPlayer } from "../../src/lib/player-matches.ts";
export const now = new Date("2026-10-19T12:00:00Z");
export function dataset(count) {
  const matches = Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    mode: i % 2 ? "singles" : "doubles",
    format: "21",
    winner: i % 7 === 0 ? null : i % 3 ? "A" : "B",
    team_a_names: ["Example player"],
    team_b_names: ["Example opponent"],
    team_a_user_ids: i % 4 === 1 ? [] : ["example-viewer"],
    team_b_user_ids: i % 4 === 1 ? ["example-viewer"] : [],
    games:
      i % 7 === 0
        ? []
        : [
            { a: 21, b: 15 },
            { a: 18, b: 21 },
            { a: 21, b: 19 },
          ],
    games_won_a: 2,
    games_won_b: 1,
    started_at: new Date(now.getTime() - i * 86400000).toISOString(),
    finished_at:
      i % 7 === 0 ? null : new Date(now.getTime() - i * 86400000 + 3600000).toISOString(),
    status: i % 7 === 0 ? "active" : "completed",
    creator_id: "example-viewer",
    best_of: 3,
    category: i % 2 ? "mens_singles" : "mixed_doubles",
    court_name: "Example court",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    duration_seconds: 3600,
    longest_rally_seconds: 19,
    notes: "Worked on consistent clears and recovering to the center.",
    opponent_nicknames: {},
    points_to_win: 21,
    tags: ["practice"],
    title: "Example practice",
    total_rallies: 80,
  }));
  return {
    matches,
    profile: {
      display_name: "Example player",
      handle: "example",
      avatar_url: null,
      home_court: "Example court",
    },
    dashboard: {
      layout: "compact",
      goal: { title: "Play twice this week", target: 2, progress: 0, unit: "matches" },
    },
    progress: { level_name: "Match Player", total_xp: 350, current_level: 3, current_streak: 2 },
    activeQuest: null,
    insight: null,
  };
}
export function legacyStats(matches) {
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
      if (m.games.at(-1)?.a > m.games.at(-1)?.b === won) deciderWins++;
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
    losses: finished.length - wins,
    winRate: finished.length ? Math.round((wins / finished.length) * 100) : 0,
    streak,
    avgMargin: games ? (margin / games).toFixed(1) : "0.0",
    decisiveGames,
    deciderWins,
  };
}
export function response(version, name, count, input = {}) {
  const d = dataset(count);
  d.matches = d.matches.map((m) => matchForPlayer(m, "example-viewer"));
  if (name === "matches") return d.matches;
  if (name === "preferences")
    return { dashboard: d.dashboard, match_defaults: {}, notifications: {} };
  if (name === "progress") return { progress: d.progress, activeQuest: null, insights: [] };
  if (name === "save") return { ok: true };
  if (name === "core" && version === "baseline") {
    const latest = d.matches.find((m) => m.winner);
    const columns = [
      "id",
      "mode",
      "winner",
      "team_a_names",
      "team_b_names",
      "team_a_user_ids",
      "team_b_user_ids",
      "games",
      "started_at",
      "finished_at",
    ];
    return {
      ...d,
      matches: undefined,
      dashboard: { layout: d.dashboard.layout },
      latestMatch: latest ? Object.fromEntries(columns.map((key) => [key, latest[key]])) : null,
      hasMatches: d.matches.some((m) => m.winner),
    };
  }
  if (name === "core")
    return {
      profile: d.profile,
      dashboard: d.dashboard,
      recentMatches: d.matches
        .slice(0, 5)
        .map(
          ({
            id,
            mode,
            format,
            winner,
            team_a_names,
            team_b_names,
            games,
            started_at,
            finished_at,
          }) => ({
            id,
            mode,
            format,
            winner,
            team_a_names,
            team_b_names,
            games,
            started_at,
            finished_at,
          }),
        ),
    };
  if (name === "summary")
    return {
      progress: d.progress,
      activeQuest: null,
      insight: null,
      hasMatches: d.matches.some((m) => m.winner),
      stats: legacyStats(d.matches),
      weekMatchCount: d.matches.filter(
        (m) => m.started_at >= (input.data?.weekStart ?? "2026-10-19T00:00:00Z"),
      ).length,
    };
  throw new Error(`Unknown fixture ${name}`);
}
