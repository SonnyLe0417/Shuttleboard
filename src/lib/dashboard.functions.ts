import { matchForPlayer } from "@/lib/player-matches";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DashboardCoreData = {
  profile: {
    display_name: string | null;
    handle: string | null;
    avatar_url: string | null;
    home_court: string | null;
  } | null;
  latestMatch: {
    id: string;
    mode: "singles" | "doubles";
    winner: "A" | "B" | null;
    team_a_names: string[];
    team_b_names: string[];
    games: Array<{ a: number; b: number }>;
    started_at: string;
    finished_at: string | null;
  } | null;
  activeQuest: {
    id: string;
    title: string;
    description: string;
    progress: number;
    target_value: number;
    status: string;
    ends_at: string;
  } | null;
  dashboard: {
    layout?: "compact" | "balanced" | "stats-heavy";
    coaching_tone?: "friendly" | "competitive" | "technical" | "blunt";
    terminology?: {
      game?: string;
      set?: string;
      rally?: string;
      match?: string;
    };
  };
  progress: {
    level_name: string;
    total_xp: number;
    current_level: number;
    current_streak: number;
  };
  insight: { label: string; description: string; confidence?: string } | null;
  hasMatches: boolean;
};

function levelName(level: number) {
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

export const getDashboardCore = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardCoreData> => {
    const db = context.supabase as any;
    const [
      profileResult,
      latestMatchResult,
      questResult,
      preferencesResult,
      progressResult,
      insightsResult,
    ] = await Promise.all([
      db
        .from("profiles")
        .select("display_name, handle, avatar_url, home_court")
        .eq("id", context.userId)
        .maybeSingle(),
      db
        .from("matches")
        .select(
          "id, mode, winner, team_a_names, team_b_names, team_a_user_ids, team_b_user_ids, games, started_at, finished_at",
        )
        .neq("status", "abandoned")
        .in("winner", ["A", "B"])
        .or(
          `creator_id.eq.${context.userId},team_a_user_ids.cs.{${context.userId}},team_b_user_ids.cs.{${context.userId}}`,
        )
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("coach_quests")
        .select("id, cadence, title, description, progress, target_value, status, ends_at")
        .eq("user_id", context.userId)
        .in("status", ["active", "completed"])
        .gt("ends_at", new Date().toISOString())
        .order("starts_at", { ascending: false })
        .limit(2),
      db.from("user_preferences").select("dashboard").eq("id", context.userId).maybeSingle(),
      db
        .from("player_progress")
        .select("total_xp, current_level, quest_cadence")
        .eq("user_id", context.userId)
        .maybeSingle(),
      db
        .from("player_insights")
        .select("insights, stats")
        .eq("user_id", context.userId)
        .maybeSingle(),
    ]);

    for (const result of [
      profileResult,
      latestMatchResult,
      questResult,
      preferencesResult,
      progressResult,
      insightsResult,
    ]) {
      if (result.error) {
        throw new Error(result.error.message);
      }
    }

    const progress = progressResult.data ?? {};
    const insights = Array.isArray(insightsResult.data?.insights)
      ? insightsResult.data.insights
      : [];
    const dashboard = (preferencesResult.data?.dashboard ?? {}) as DashboardCoreData["dashboard"];
    return {
      profile: profileResult.data ?? null,
      latestMatch: latestMatchResult.data
        ? matchForPlayer(latestMatchResult.data, context.userId)
        : null,
      activeQuest:
        questResult.data?.find(
          (quest: any) => quest.cadence === (progress.quest_cadence ?? "weekly"),
        ) ?? null,
      dashboard: {
        layout: dashboard.layout,
        coaching_tone: dashboard.coaching_tone,
        terminology: dashboard.terminology,
      },
      progress: {
        total_xp: Number(progress.total_xp ?? 0),
        current_level: Number(progress.current_level ?? 1),
        level_name: levelName(Number(progress.current_level ?? 1)),
        current_streak: Number(insightsResult.data?.stats?.currentStreak ?? 0),
      },
      insight: insights[0] ?? null,
      hasMatches: Boolean(latestMatchResult.data),
    };
  });
