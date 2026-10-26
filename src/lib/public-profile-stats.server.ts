type Result = {
  mode: string;
  winner: string | null;
  team_a_user_ids: string[] | null;
  team_b_user_ids: string[] | null;
};
export function publicResultStats(rows: Result[], userId: string) {
  let wins = 0,
    streak = 0,
    streakOpen = true;
  for (const match of rows) {
    const won = (match.team_a_user_ids ?? []).includes(userId)
      ? match.winner === "A"
      : match.winner === "B";
    if (won) wins++;
    if (streakOpen && won) streak++;
    else streakOpen = false;
  }
  return {
    matches: rows.length,
    wins,
    losses: rows.length - wins,
    winRate: rows.length ? Math.round((wins / rows.length) * 100) : 0,
    currentStreak: streak,
    singles: rows.filter((row) => row.mode === "singles").length,
    doubles: rows.filter((row) => row.mode === "doubles").length,
  };
}
export async function publicStats(db: any, userId: string) {
  const rows: Result[] = [];
  // Supabase caps each response. Walk every eligible result with deterministic ordering.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db
      .from("matches")
      .select("mode, winner, team_a_user_ids, team_b_user_ids, status")
      .eq("status", "finished")
      .or(`team_a_user_ids.cs.{${userId}},team_b_user_ids.cs.{${userId}}`)
      .order("finished_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + 499);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 500) break;
  }
  return publicResultStats(rows, userId);
}
