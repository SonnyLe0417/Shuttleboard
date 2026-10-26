import type { dashboardTimer, DashboardSpan } from "./dashboard-timing";
import { matchForPlayer } from "./player-matches";
import {
  dashboardStats,
  dashboardLevelName,
  type DashboardCoreData,
  type DashboardSummaryData,
} from "./dashboard-model";

const RECENT_COLUMNS =
  "id,mode,format,winner,team_a_names,team_b_names,team_a_user_ids,team_b_user_ids,games,started_at,finished_at";
const STAT_COLUMNS = "winner,games,team_a_user_ids,team_b_user_ids,started_at";
function checked(result: any) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
export async function readDashboardCore(db: any, userId: string): Promise<DashboardCoreData> {
  const [profile, prefs, matches] = await Promise.all([
    db
      .from("profiles")
      .select("display_name,handle,avatar_url,home_court")
      .eq("id", userId)
      .maybeSingle(),
    db.from("user_preferences").select("dashboard").eq("id", userId).maybeSingle(),
    db.from("matches").select(RECENT_COLUMNS).order("started_at", { ascending: false }).limit(5),
  ]);
  return {
    profile: checked(profile) ?? null,
    dashboard: checked(prefs)?.dashboard ?? {},
    recentMatches: (checked(matches) ?? []).map((row: any) => {
      const { team_a_user_ids: _a, team_b_user_ids: _b, ...summary } = matchForPlayer(row, userId);
      return summary;
    }),
  };
}
export async function readDashboardSummary(
  db: any,
  userId: string,
  weekStart: string,
  timer?: ReturnType<typeof dashboardTimer>,
): Promise<DashboardSummaryData> {
  const timed = <T>(name: DashboardSpan, work: () => T | PromiseLike<T>) =>
    timer ? timer.measure(name, work) : Promise.resolve(work());
  const [matches, quests, progress, insights, completed] = await Promise.all([
    timed("matches", () =>
      db.from("matches").select(STAT_COLUMNS).order("started_at", { ascending: false }).limit(100),
    ),
    timed("quests", () =>
      db
        .from("coach_quests")
        .select("id,cadence,title,description,progress,target_value,status,ends_at")
        .eq("user_id", userId)
        .in("status", ["active", "completed"])
        .gt("ends_at", new Date().toISOString())
        .order("starts_at", { ascending: false })
        .limit(2),
    ),
    timed("progress", () =>
      db
        .from("player_progress")
        .select("total_xp,current_level,quest_cadence")
        .eq("user_id", userId)
        .maybeSingle(),
    ),
    timed("insights", () =>
      db.from("player_insights").select("insights,stats").eq("user_id", userId).maybeSingle(),
    ),
    // Preserve existence semantics even when >100 newer matches are unfinished.
    timed("completed", () =>
      db
        .from("matches")
        .select("id")
        .neq("status", "abandoned")
        .in("winner", ["A", "B"])
        .or(`creator_id.eq.${userId},team_a_user_ids.cs.{${userId}},team_b_user_ids.cs.{${userId}}`)
        .order("started_at", { ascending: false })
        .limit(1),
    ),
  ]);
  const aggregate = () => {
    const rows = (checked(matches) ?? []).map((row: any) => matchForPlayer(row, userId));
    const p = checked(progress) ?? {},
      i = checked(insights) ?? {},
      q = checked(quests) ?? [];
    return {
      stats: dashboardStats(rows),
      weekMatchCount: rows.filter((row: any) => new Date(row.started_at) >= new Date(weekStart))
        .length,
      hasMatches: (checked(completed) ?? []).length > 0,
      activeQuest: q.find((quest: any) => quest.cadence === (p.quest_cadence ?? "weekly")) ?? null,
      progress: {
        total_xp: Number(p.total_xp ?? 0),
        current_level: Number(p.current_level ?? 1),
        level_name: dashboardLevelName(Number(p.current_level ?? 1)),
        current_streak: Number(i.stats?.currentStreak ?? 0),
      },
      insight: Array.isArray(i.insights) ? (i.insights[0] ?? null) : null,
    };
  };
  return timer ? timer.measure("aggregate", aggregate) : aggregate();
}
