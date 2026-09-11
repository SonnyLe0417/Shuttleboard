import {
  nextAllowedNotificationAt,
  notificationEnabled,
} from "../../supabase/functions/_shared/notification-schedule";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { matchForPlayer, isCompletedMatch, levelName } from "@/lib/player-matches";
import { eligibleAchievements } from "@/lib/achievement-catalog";

const XP = { match: 10, reflection: 5, review: 3, quest: 25, focus: 5, personalBest: 15 } as const;

type NotificationKind = "quest" | "level_up" | "achievement" | "reminder" | "summary" | "streak";

function isMissingNotificationTable(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(
    error &&
    (error.code === "42P01" ||
      /schema cache|could not find the table|relation .* does not exist/i.test(
        error.message ?? "",
      )),
  );
}

export async function queueNotification(
  db: any,
  userId: string,
  eventKey: string,
  notificationType: NotificationKind,
  title: string,
  body: string,
  url = "/progress",
) {
  const { data: prefRow } = await db
    .from("user_preferences")
    .select("notifications")
    .eq("id", userId)
    .maybeSingle();
  const notifications = (prefRow?.notifications ?? {}) as Record<string, any>;
  if (!notificationEnabled(notifications, notificationType)) return;

  const availableAt = nextAllowedNotificationAt(new Date(), notifications);
  const { data: event, error } = await db
    .from("notification_events")
    .insert({
      user_id: userId,
      event_key: eventKey,
      notification_type: notificationType,
      title,
      body,
      payload: { url, tag: eventKey },
      available_at: availableAt ?? new Date(Date.now() + 86_400_000).toISOString(),
    })
    .select("id, available_at")
    .maybeSingle();
  if (error) {
    if (error.code === "23505" || isMissingNotificationTable(error)) return;
    throw new Error(error.message);
  }

  // A leased worker delivers immediate and delayed notifications off the request path.
  void event;
}

function confidence(count: number) {
  return count < 3 ? "early signal" : count < 10 ? "developing pattern" : "established pattern";
}

export function buildInsights(matches: any[]) {
  const finished = matches.filter(isCompletedMatch);
  const count = finished.length;
  if (!count) return [];
  const wins = finished.filter((match) => match.winner === "A").length;
  const winRate = Math.round((wins / count) * 100);
  const avgMargin = finished.length
    ? finished.reduce((total, match) => {
        const games = (match.games ?? []) as Array<{ a: number; b: number }>;
        return total + games.reduce((sum, game) => sum + Math.abs(game.a - game.b), 0);
      }, 0) /
      Math.max(
        1,
        finished.reduce((sum, match) => sum + (match.games?.length ?? 0), 0),
      )
    : 0;
  const deciders = finished.filter((match) => (match.games?.length ?? 0) >= 3);
  const deciderWins = deciders.filter((match) => match.winner === "A").length;
  let streak = 0;
  for (const match of finished) {
    if (match.winner !== "A") break;
    streak += 1;
  }
  const result = [
    {
      key: "overall-form",
      label: "Overall form",
      description: `${winRate}% win rate across ${count} completed matches.`,
    },
    {
      key: "margin",
      label: "Margin tracker",
      description: `Your average game margin is ${avgMargin.toFixed(1)} points.`,
    },
    {
      key: "deciders",
      label: "Deciding-game focus",
      description: `${deciderWins} of ${deciders.length} matches with a deciding game were wins.`,
    },
  ];
  if (streak >= 3) {
    result.push({
      key: "streak",
      label: "Current momentum",
      description: `You have won ${streak} completed matches in a row.`,
    });
  }
  return result.map((insight) => ({ ...insight, confidence: confidence(count) }));
}

export function buildProfileStats(matches: any[]) {
  const finished = matches.filter(isCompletedMatch);
  const wins = finished.filter((match) => match.winner === "A").length;
  const singles = finished.filter((match) => match.mode === "singles");
  const doubles = finished.filter((match) => match.mode === "doubles");
  return {
    matches: finished.length,
    wins,
    losses: Math.max(0, finished.length - wins),
    winRate: finished.length ? Math.round((wins / finished.length) * 100) : 0,
    currentStreak: (() => {
      let streak = 0;
      for (const match of finished) {
        if (match.winner !== "A") break;
        streak += 1;
      }
      return streak;
    })(),
    singles: singles.length,
    doubles: doubles.length,
    singlesWinRate: singles.length
      ? Math.round((singles.filter((match) => match.winner === "A").length / singles.length) * 100)
      : 0,
    doublesWinRate: doubles.length
      ? Math.round((doubles.filter((match) => match.winner === "A").length / doubles.length) * 100)
      : 0,
  };
}

async function awardXp(db: any, userId: string, eventKey: string, kind: string, xp: number) {
  const { data, error } = await db.rpc("award_player_rewards", {
    p_user_id: userId,
    p_events: [{ event_key: eventKey, kind, xp }],
  });
  if (error) throw new Error(error.message);
  if (data.current_level > data.previous_level)
    await queueNotification(
      db,
      userId,
      `level-up:${data.current_level}`,
      "level_up",
      `Level ${data.current_level} unlocked`,
      `You reached ${levelName(data.current_level)}.`,
    );
  return data.added_xp > 0;
}
async function backfillMatchXp(
  db: any,
  userId: string,
  matches: any[],
  existingEventKeys: Set<string>,
) {
  const events = matches
    .filter(isCompletedMatch)
    .filter((m) => !existingEventKeys.has(`match:${m.id}:saved`))
    .map((m) => ({ event_key: `match:${m.id}:saved`, kind: "match", xp: XP.match }));
  const { data, error } = await db.rpc("award_player_rewards", {
    p_user_id: userId,
    p_events: events,
  });
  if (error) throw new Error(error.message);
  if (data.current_level > data.previous_level)
    await queueNotification(
      db,
      userId,
      `level-up:${data.current_level}`,
      "level_up",
      `Level ${data.current_level} unlocked`,
      `You reached ${levelName(data.current_level)}.`,
    );
}
export async function awardProgressXp(
  db: any,
  userId: string,
  eventKey: string,
  kind: string,
  xp: number,
) {
  return awardXp(db, userId, eventKey, kind, xp);
}

export function period(cadence: "weekly" | "monthly") {
  const now = new Date();
  const start = new Date(now);
  if (cadence === "weekly") {
    const mondayOffset = (now.getUTCDay() + 6) % 7;
    start.setUTCDate(now.getUTCDate() - mondayOffset);
  } else {
    start.setUTCDate(1);
  }
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  if (cadence === "weekly") end.setUTCDate(end.getUTCDate() + 7);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function ensureQuest(
  db: any,
  userId: string,
  cadence: "weekly" | "monthly",
  matchCount: number,
  matches: any[],
) {
  const { start, end } = period(cadence);
  const { data: existing } = await db
    .from("coach_quests")
    .select("*")
    .eq("user_id", userId)
    .eq("cadence", cadence)
    .eq("starts_at", start)
    .maybeSingle();
  if (existing) {
    return syncQuestProgress(db, userId, existing, matches);
  }
  const target = cadence === "weekly" ? 2 : 6;
  const quest = {
    user_id: userId,
    cadence,
    title: matchCount ? `Play ${target} matches` : "Start your match story",
    description: matchCount
      ? "Build useful data by showing up consistently. Progress counts every completed match."
      : "Log your first completed match so Coach’s Corner can learn your baseline.",
    category: "matches",
    target_value: matchCount ? target : 1,
    progress: 0,
    starts_at: start,
    ends_at: end,
  };
  const { error: insertError } = await db
    .from("coach_quests")
    .upsert(quest, { onConflict: "user_id,cadence,starts_at", ignoreDuplicates: true });
  if (insertError) throw new Error(insertError.message);
  const { data, error } = await db
    .from("coach_quests")
    .select("*")
    .eq("user_id", userId)
    .eq("cadence", cadence)
    .eq("starts_at", start)
    .single();
  if (error) throw new Error(error.message);
  await queueNotification(
    db,
    userId,
    `quest:${data.id}:created`,
    "quest",
    "A new Coach's Corner quest is ready",
    `${data.title} · ${data.description}`,
    "/progress",
  );
  return syncQuestProgress(db, userId, data, matches);
}

async function syncQuestProgress(db: any, userId: string, quest: any, matches: any[]) {
  if (!quest || quest.status !== "active") return quest;
  const startsAt = Date.parse(quest.starts_at);
  const endsAt = Date.parse(quest.ends_at);
  const progress = matches.filter((match) => {
    if (!isCompletedMatch(match)) return false;
    const startedAt = Date.parse(match.started_at ?? "");
    return (
      Number.isFinite(startedAt) &&
      (!Number.isFinite(startsAt) || startedAt >= startsAt) &&
      (!Number.isFinite(endsAt) || startedAt < endsAt)
    );
  }).length;
  const target = Math.max(1, Number(quest.target_value ?? 1));
  const nextProgress = Math.max(Number(quest.progress ?? 0), Math.min(target, progress));
  const nextStatus = nextProgress >= target ? "completed" : "active";
  const changed = quest.progress !== nextProgress || quest.status !== nextStatus;
  let current = {
    ...quest,
    progress: nextProgress,
    status: nextStatus,
    completed_at:
      nextStatus === "completed" ? (quest.completed_at ?? new Date().toISOString()) : null,
  };
  if (changed) {
    const { data: updated, error } = await db
      .from("coach_quests")
      .update({
        progress: current.progress,
        status: current.status,
        completed_at: current.completed_at,
      })
      .eq("id", quest.id)
      .eq("user_id", userId)
      .eq("status", "active")
      .lte("progress", current.progress)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    current = updated ?? quest;
  }
  if (nextStatus === "completed" && quest.status !== "completed") {
    await awardXp(db, userId, `quest:${quest.id}:completed`, "quest", XP.quest);
    await queueNotification(
      db,
      userId,
      `quest:${quest.id}:completed`,
      "quest",
      "Coach quest completed",
      `You completed ${quest.title}.`,
      "/progress",
    );
  }
  return current;
}

async function refreshPersonalBests(db: any, userId: string, matches: any[]) {
  const finished = matches.filter(isCompletedMatch);
  const candidates = new Map<string, { value: number; unit: string; source_match_id?: string }>();
  const longestRally = Math.max(
    0,
    ...finished.map((match) => Number(match.longest_rally_seconds ?? 0)),
  );
  if (longestRally > 0)
    candidates.set("longest_rally", {
      value: longestRally,
      unit: "sec",
      source_match_id: finished.find((m) => Number(m.longest_rally_seconds) === longestRally)?.id,
    });
  const highestGame = Math.max(
    0,
    ...finished.flatMap((match) => (match.games ?? []).map((game: any) => Number(game.a ?? 0))),
  );
  if (highestGame > 0)
    candidates.set("highest_game_score", {
      value: highestGame,
      unit: "points",
      source_match_id: finished.find((m) => m.games?.some((g: any) => Number(g.a) === highestGame))
        ?.id,
    });
  const matchCount = finished.length;
  if (matchCount > 0) candidates.set("matches_played", { value: matchCount, unit: "matches" });
  for (const [metricKey, candidate] of candidates) {
    const { error: bestError } = await db.rpc("improve_personal_best", {
      p_user_id: userId,
      p_metric_key: metricKey,
      p_value: candidate.value,
      p_unit: candidate.unit,
      p_source_match_id: candidate.source_match_id ?? null,
    });
    if (bestError) throw new Error(bestError.message);
  }
}

async function ensureAchievement(db: any, userId: string, key: string, awardKey: string) {
  const { error } = await db.from("player_achievements").upsert(
    {
      user_id: userId,
      achievement_key: key,
      award_key: awardKey,
    },
    { onConflict: "user_id,achievement_key", ignoreDuplicates: true },
  );
  if (error && error.code !== "23505") throw new Error(error.message);
  if (!error) {
    await queueNotification(
      db,
      userId,
      `achievement:${key}`,
      "achievement",
      "Achievement unlocked",
      `You unlocked ${key.replaceAll("-", " ")}.`,
    );
  }
}

async function rows(query: any): Promise<any[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}
async function allMatches(db: any, userId: string) {
  const result: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await rows(
      db
        .from("matches")
        .select(
          "id,creator_id,mode,best_of,games,winner,status,duration_seconds,longest_rally_seconds,started_at,finished_at,team_a_names,team_b_names,team_a_user_ids,team_b_user_ids",
        )
        .or(`creator_id.eq.${userId},team_a_user_ids.cs.{${userId}},team_b_user_ids.cs.{${userId}}`)
        .order("started_at", { ascending: false })
        .order("id")
        .range(offset, offset + 499),
    );
    result.push(...page.map((m: any) => matchForPlayer(m, userId)));
    if (page.length < 500) return result;
  }
}
export async function readProgressSummary(db: any, userId: string) {
  const [matches, progressRows, quests, personalBests, achievements] = await Promise.all([
    allMatches(db, userId),
    rows(db.from("player_progress").select("*").eq("user_id", userId)),
    rows(
      db
        .from("coach_quests")
        .select("*")
        .eq("user_id", userId)
        .order("starts_at", { ascending: false }),
    ),
    rows(
      db
        .from("personal_bests")
        .select("*")
        .eq("user_id", userId)
        .order("achieved_at", { ascending: false }),
    ),
    rows(
      db
        .from("player_achievements")
        .select("*")
        .eq("user_id", userId)
        .order("earned_at", { ascending: false }),
    ),
  ]);
  const progress = progressRows[0] ?? {
    total_xp: 0,
    current_level: 1,
    quest_cadence: "weekly",
    streaks_enabled: true,
    celebration_enabled: true,
  };
  const { start, end } = period(progress.quest_cadence);
  const activeQuest = quests.find(
    (q: any) =>
      q.cadence === progress.quest_cadence &&
      q.starts_at >= start &&
      q.starts_at < end &&
      q.status !== "skipped" &&
      q.status !== "expired",
  ) ?? {
    id: null,
    title: matches.some(isCompletedMatch)
      ? "Play " + (progress.quest_cadence === "monthly" ? 6 : 2) + " matches"
      : "Start your match story",
    description: "Every completed match counts. Your next save records this quest.",
    cadence: progress.quest_cadence,
    category: "matches",
    target_value: matches.some(isCompletedMatch)
      ? progress.quest_cadence === "monthly"
        ? 6
        : 2
      : 1,
    progress: 0,
    status: "active",
    starts_at: start,
    ends_at: end,
  };
  return {
    progress: { ...progress, level_name: levelName(progress.current_level) },
    stats: buildProfileStats(matches),
    activeQuest,
    quests,
    personalBests,
    achievements,
    insights: buildInsights(matches),
    setupRequired: false,
  };
}
export async function syncPlayerProgress(userId: string) {
  const snapshotAt = new Date().toISOString();
  const db = supabaseAdmin as any;
  const [matches, progressRows, eventRows, reflections, memories] = await Promise.all([
    allMatches(db, userId),
    rows(db.from("player_progress").select("*").eq("user_id", userId)),
    rows(db.from("reward_events").select("event_key").eq("user_id", userId)),
    rows(db.from("match_reflections").select("*").eq("user_id", userId)),
    rows(db.from("opponent_memories").select("*").eq("user_id", userId)),
  ]);
  const progress = progressRows[0] ?? { quest_cadence: "weekly" };
  await backfillMatchXp(db, userId, matches, new Set(eventRows.map((e: any) => e.event_key)));
  const events = [
    ...reflections
      .filter((r: any) =>
        [r.went_well, r.difficult, r.next_focus].some((v) => String(v ?? "").trim()),
      )
      .map((r: any) => ({
        event_key: `reflection:${r.match_id}:completed`,
        kind: "reflection",
        xp: XP.reflection,
      })),
    ...memories
      .filter((m: any) =>
        [m.worked, m.difficult, m.tendencies, m.next_plan].some((v) => String(v ?? "").trim()),
      )
      .map((m: any) => ({
        event_key: `opponent:${m.opponent_key}:first-note`,
        kind: "focus",
        xp: XP.focus,
      })),
  ];
  const { error: rewardError } = await db.rpc("award_player_rewards", {
    p_user_id: userId,
    p_events: events,
  });
  if (rewardError) throw new Error(rewardError.message);
  const { error: expireError } = await db
    .from("coach_quests")
    .update({ status: "expired" })
    .eq("user_id", userId)
    .eq("status", "active")
    .lt("ends_at", new Date().toISOString());
  if (expireError) throw new Error(expireError.message);
  await ensureQuest(
    db,
    userId,
    progress.quest_cadence,
    matches.filter(isCompletedMatch).length,
    matches,
  );
  const { error: insightsError } = await db.rpc("store_player_insights", {
    p_user_id: userId,
    p_insights: buildInsights(matches),
    p_stats: buildProfileStats(matches),
    p_count: matches.filter(isCompletedMatch).length,
    p_generated_at: snapshotAt,
  });
  if (insightsError) throw new Error(insightsError.message);
  await refreshPersonalBests(db, userId, matches);
  const [bests, quests] = await Promise.all([
    rows(db.from("personal_bests").select("*").eq("user_id", userId)),
    rows(db.from("coach_quests").select("*").eq("user_id", userId)),
  ]);
  for (const quest of quests.filter((q: any) => q.status === "completed")) {
    await awardXp(db, userId, `quest:${quest.id}:completed`, "quest", XP.quest);
  }
  const { data: latestProgress, error: latestError } = await db
    .from("player_progress")
    .select("current_level")
    .eq("user_id", userId)
    .single();
  if (latestError) throw new Error(latestError.message);
  if (latestProgress.current_level > 1)
    await queueNotification(
      db,
      userId,
      `level-up:${latestProgress.current_level}`,
      "level_up",
      `Level ${latestProgress.current_level} unlocked`,
      `You reached ${levelName(latestProgress.current_level)}.`,
    );
  for (const achievement of eligibleAchievements(matches, reflections, bests, quests, memories))
    await ensureAchievement(db, userId, achievement.achievement_key, achievement.award_key);
}
export async function synchronizeProgressForMatch(db: any, matchId: string) {
  const { data: match, error } = await db
    .from("matches")
    .select("creator_id,team_a_user_ids,team_b_user_ids")
    .eq("id", matchId)
    .single();
  if (error) throw new Error(error.message);
  for (const userId of new Set<string>([
    match.creator_id,
    ...match.team_a_user_ids,
    ...match.team_b_user_ids,
  ]))
    await syncPlayerProgress(userId);
}
