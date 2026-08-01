import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const reflectionInput = z.object({
  match_id: z.string().uuid(),
  went_well: z.string().max(1000).default(""),
  difficult: z.string().max(1000).default(""),
  next_focus: z.string().max(1000).default(""),
  confidence_before: z.number().int().min(1).max(5).nullable().optional(),
  confidence_after: z.number().int().min(1).max(5).nullable().optional(),
});

const memoryInput = z.object({
  opponent_id: z.string().uuid().nullable().optional(),
  opponent_key: z.string().min(1).max(120),
  opponent_name: z.string().min(1).max(120),
  worked: z.string().max(1000).default(""),
  difficult: z.string().max(1000).default(""),
  tendencies: z.string().max(1000).default(""),
  next_plan: z.string().max(1000).default(""),
});

const progressSettingsInput = z.object({
  quest_cadence: z.enum(["weekly", "monthly"]).optional(),
  streaks_enabled: z.boolean().optional(),
  celebration_enabled: z.boolean().optional(),
});

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

function localMinutes(date: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24;
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
    return hour * 60 + minute;
  } catch {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}

function parseClock(value: unknown, fallback: number) {
  const match = typeof value === "string" ? /^(\d{2}):(\d{2})$/.exec(value) : null;
  if (!match) return fallback;
  return Math.min(1439, Number(match[1]) * 60 + Number(match[2]));
}

function inClockWindow(minutes: number, start: number, end: number) {
  if (start === end) return true;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

function nextAllowedNotificationAt(now: Date, notifications: Record<string, any>) {
  const timezone = typeof notifications.timezone === "string" ? notifications.timezone : "UTC";
  const scheduleEnabled = notifications.schedule_enabled === true;
  const quietEnabled = notifications.quiet_hours_enabled === true;
  const scheduleStart = parseClock(notifications.schedule_start, 8 * 60);
  const scheduleEnd = parseClock(notifications.schedule_end, 21 * 60);
  const quietStart = parseClock(notifications.quiet_hours_start, 22 * 60);
  const quietEnd = parseClock(notifications.quiet_hours_end, 7 * 60);
  const allowed = (date: Date) => {
    const minutes = localMinutes(date, timezone);
    return (
      (!scheduleEnabled || inClockWindow(minutes, scheduleStart, scheduleEnd)) &&
      (!quietEnabled || !inClockWindow(minutes, quietStart, quietEnd))
    );
  };
  if (allowed(now)) return now.toISOString();
  const cursor = new Date(now);
  for (let minute = 1; minute <= 60 * 48; minute += 1) {
    cursor.setTime(now.getTime() + minute * 60_000);
    if (allowed(cursor)) return cursor.toISOString();
  }
  return new Date(now.getTime() + 60 * 60_000).toISOString();
}

async function queueNotification(
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
  const enabledKey =
    notificationType === "quest"
      ? "quest_reminders"
      : notificationType === "level_up"
        ? "level_up_notifications"
        : notificationType === "achievement"
          ? "achievement_notifications"
          : notificationType === "streak"
            ? "win_streak_alerts"
            : "weekly_summary";
  if (notifications[enabledKey] === false) return;

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
      available_at: availableAt,
    })
    .select("id, available_at")
    .maybeSingle();
  if (error) {
    if (error.code === "23505" || isMissingNotificationTable(error)) return;
    throw new Error(error.message);
  }

  // Deliver immediately when the event is eligible. A scheduled Edge Function
  // can deliver rows that are held by quiet hours or had no active subscription.
  if (event && new Date(event.available_at).getTime() <= Date.now()) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { sendToUser } = await import("@/lib/push.server");
      const result = await sendToUser(supabaseAdmin, userId, { title, body, url, tag: eventKey });
      if (result.sent > 0) {
        await supabaseAdmin
          .from("notification_events")
          .update({ status: "sent", sent_at: new Date().toISOString(), attempt_count: 1 })
          .eq("id", event.id);
      }
    } catch {
      // Keep the event pending so the scheduled worker can retry it.
    }
  }
}

function levelForXp(xp: number) {
  const thresholds = [0, 100, 250, 500, 850, 1300, 1850, 2500];
  let level = 1;
  thresholds.forEach((threshold, index) => {
    if (xp >= threshold) level = index + 1;
  });
  if (xp >= 2500) level += Math.floor((xp - 2500) / 700);
  return level;
}

function levelName(level: number) {
  if (level >= 5) return "Court Leader";
  if (level === 4) return "Consistent Competitor";
  if (level === 3) return "Match Player";
  if (level === 2) return "Rally Builder";
  return "New Player";
}

function confidence(count: number) {
  return count < 3 ? "early signal" : count < 10 ? "developing pattern" : "established pattern";
}

function buildInsights(matches: any[]) {
  const finished = matches.filter((match) => match.status === "finished" && match.winner);
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
  const streak = finished.reduce(
    (length, match) => (match.winner === "A" ? length + 1 : length),
    0,
  );
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

function buildProfileStats(matches: any[]) {
  const finished = matches.filter((match) => match.status === "finished" && match.winner);
  const wins = finished.filter((match) => match.winner === "A").length;
  const singles = finished.filter((match) => match.mode === "singles");
  const doubles = finished.filter((match) => match.mode === "doubles");
  return {
    matches: finished.length,
    wins,
    losses: Math.max(0, finished.length - wins),
    winRate: finished.length ? Math.round((wins / finished.length) * 100) : 0,
    currentStreak: finished.reduce(
      (streak, match) => (match.winner === "A" ? streak + 1 : streak),
      0,
    ),
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
  const { error } = await db
    .from("reward_events")
    .insert({ user_id: userId, event_key: eventKey, kind, xp });
  if (error) {
    if (error.code === "23505") return false;
    throw new Error(error.message);
  }
  const { data: current } = await db
    .from("player_progress")
    .select("total_xp, current_level")
    .eq("user_id", userId)
    .maybeSingle();
  const totalXp = Number(current?.total_xp ?? 0) + xp;
  const previousLevel = Number(
    current?.current_level ?? levelForXp(Number(current?.total_xp ?? 0)),
  );
  const nextLevel = levelForXp(totalXp);
  const { error: progressError } = await db.from("player_progress").upsert({
    user_id: userId,
    total_xp: totalXp,
    current_level: nextLevel,
  });
  if (progressError) throw new Error(progressError.message);
  if (nextLevel > previousLevel) {
    await queueNotification(
      db,
      userId,
      `level-up:${nextLevel}`,
      "level_up",
      `Level ${nextLevel} unlocked`,
      `You reached ${levelName(nextLevel)} with ${totalXp} XP.`,
    );
  }
  return true;
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

function period(cadence: "weekly" | "monthly") {
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
) {
  const { start, end } = period(cadence);
  const { data: existing } = await db
    .from("coach_quests")
    .select("*")
    .eq("user_id", userId)
    .eq("cadence", cadence)
    .eq("starts_at", start)
    .maybeSingle();
  if (existing) return existing;
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
  const { data, error } = await db.from("coach_quests").insert(quest).select("*").single();
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
  return data;
}

async function refreshPersonalBests(db: any, userId: string, matches: any[]) {
  const finished = matches.filter((match) => match.status === "finished" && match.winner);
  const candidates = new Map<string, { value: number; unit: string; source_match_id?: string }>();
  const longestRally = Math.max(
    0,
    ...finished.map((match) => Number(match.longest_rally_seconds ?? 0)),
  );
  if (longestRally > 0) candidates.set("longest_rally", { value: longestRally, unit: "sec" });
  const highestGame = Math.max(
    0,
    ...finished.flatMap((match) => (match.games ?? []).map((game: any) => Number(game.a ?? 0))),
  );
  if (highestGame > 0) candidates.set("highest_game_score", { value: highestGame, unit: "points" });
  const matchCount = finished.length;
  if (matchCount > 0) candidates.set("matches_played", { value: matchCount, unit: "matches" });
  for (const [metricKey, candidate] of candidates) {
    const { data: current } = await db
      .from("personal_bests")
      .select("value")
      .eq("user_id", userId)
      .eq("metric_key", metricKey)
      .maybeSingle();
    if (Number(current?.value ?? 0) >= candidate.value) continue;
    await db
      .from("personal_bests")
      .upsert(
        { user_id: userId, metric_key: metricKey, ...candidate },
        { onConflict: "user_id,metric_key" },
      );
    await awardXp(
      db,
      userId,
      `personal-best:${metricKey}:${candidate.value}`,
      "personalBest",
      XP.personalBest,
    );
  }
}

async function ensureAchievement(db: any, userId: string, key: string, awardKey: string) {
  const { data: existing } = await db
    .from("player_achievements")
    .select("achievement_key")
    .eq("user_id", userId)
    .eq("achievement_key", key)
    .maybeSingle();
  if (existing) return;
  const { error } = await db.from("player_achievements").insert({
    user_id: userId,
    achievement_key: key,
    award_key: awardKey,
  });
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

function isMissingProgressTable(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(
    error &&
    (error.code === "42P01" ||
      /schema cache|could not find the table|relation .* does not exist/i.test(
        error.message ?? "",
      )),
  );
}

export const getProgressSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const [
      matchesResult,
      progressResult,
      questsResult,
      bestsResult,
      achievementsResult,
      insightsResult,
    ] = await Promise.all([
      db
        .from("matches")
        .select(
          "id, mode, games, winner, status, duration_seconds, longest_rally_seconds, started_at, team_b_names, team_b_user_ids",
        )
        .order("started_at", { ascending: false })
        .limit(100),
      db.from("player_progress").select("*").eq("user_id", context.userId).maybeSingle(),
      db
        .from("coach_quests")
        .select("*")
        .eq("user_id", context.userId)
        .order("starts_at", { ascending: false })
        .limit(12),
      db
        .from("personal_bests")
        .select("*")
        .eq("user_id", context.userId)
        .order("achieved_at", { ascending: false }),
      db
        .from("player_achievements")
        .select("*")
        .eq("user_id", context.userId)
        .order("earned_at", { ascending: false }),
      db.from("player_insights").select("*").eq("user_id", context.userId).maybeSingle(),
    ]);
    if (matchesResult.error) throw new Error(matchesResult.error.message);
    const matches = matchesResult.data ?? [];
    const progressTablesMissing = [
      progressResult,
      questsResult,
      bestsResult,
      achievementsResult,
      insightsResult,
    ].some((result) => isMissingProgressTable(result.error));
    if (progressTablesMissing) {
      const fallbackProgress = {
        total_xp: 0,
        current_level: 1,
        level_name: "New Player",
        quest_cadence: "weekly",
        streaks_enabled: true,
        celebration_enabled: true,
        setupRequired: true,
      };
      return {
        progress: fallbackProgress,
        stats: buildProfileStats(matches),
        activeQuest: {
          title: "Build your baseline",
          description: "Apply the Progress migration to start earning XP and personalized quests.",
          cadence: "weekly",
          progress: 0,
          target_value: 1,
        },
        quests: [],
        personalBests: [],
        achievements: [],
        insights: buildInsights(matches),
        setupRequired: true,
      };
    }
    const progress = progressResult.data ?? {
      total_xp: 0,
      current_level: 1,
      quest_cadence: "weekly",
      streaks_enabled: true,
      celebration_enabled: true,
    };
    const quest = await ensureQuest(
      db,
      context.userId,
      progress.quest_cadence,
      matches.filter((match: any) => match.status === "finished").length,
    );
    const insights = buildInsights(matches);
    await db.from("player_insights").upsert({
      user_id: context.userId,
      insights,
      source_match_count: matches.filter((match: any) => match.status === "finished").length,
    });
    await refreshPersonalBests(db, context.userId, matches);
    const finished = matches.filter((match: any) => match.status === "finished" && match.winner);
    if (finished.length >= 1)
      await ensureAchievement(db, context.userId, "first-match", "court-journal-accent");
    if (finished.length >= 2)
      await ensureAchievement(db, context.userId, "consistent-player", "extra-progress-filter");
    if (finished.filter((match: any) => (match.games?.length ?? 0) >= 3).length >= 3)
      await ensureAchievement(db, context.userId, "decider-tested", "decider-coaching-prompt");
    return {
      progress: { ...progress, level_name: levelName(progress.current_level ?? 1) },
      stats: buildProfileStats(matches),
      activeQuest: quest,
      quests: questsResult.data ?? [],
      personalBests: bestsResult.data ?? [],
      achievements: achievementsResult.data ?? [],
      insights,
    };
  });

export const saveMatchReflection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => reflectionInput.parse(raw))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: reflection, error } = await db
      .from("match_reflections")
      .upsert({ user_id: context.userId, ...data }, { onConflict: "user_id,match_id" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await awardXp(
      db,
      context.userId,
      `reflection:${data.match_id}:completed`,
      "reflection",
      XP.reflection,
    );
    return reflection;
  });

export const saveOpponentMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => memoryInput.parse(raw))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: memory, error } = await db
      .from("opponent_memories")
      .upsert({ user_id: context.userId, ...data }, { onConflict: "user_id,opponent_key" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await awardXp(
      db,
      context.userId,
      `opponent:${data.opponent_key}:first-note`,
      "focus",
      XP.focus,
    );
    return memory;
  });

export const updateProgressSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => progressSettingsInput.parse(raw))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { error } = await db.from("player_progress").upsert({ user_id: context.userId, ...data });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
