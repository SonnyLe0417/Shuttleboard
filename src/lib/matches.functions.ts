import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { TablesInsert } from "@/integrations/supabase/types";
import { awardProgressXp } from "@/lib/progress.functions";
import { completeReferralForUser } from "@/lib/growth.functions";

const gameSchema = z.object({ a: z.number().int(), b: z.number().int() });

const saveMatchInput = z.object({
  mode: z.enum(["singles", "doubles"]),
  category: z
    .enum(["mens-singles", "womens-singles", "mens-doubles", "womens-doubles", "mixed-doubles"])
    .default("mens-singles"),
  title: z.string().max(80).optional(),
  court_name: z.string().max(80).optional(),
  format: z.string().min(1).max(40),
  points_to_win: z.number().int().positive(),
  best_of: z.number().int().min(1).max(9).default(3),
  team_a_names: z.array(z.string().min(1).max(60)).min(1).max(2),
  team_b_names: z.array(z.string().min(1).max(60)).min(1).max(2),
  team_a_handles: z.array(z.string()).default([]),
  team_b_handles: z.array(z.string()).default([]),
  games: z.array(gameSchema).min(1),
  winner: z.enum(["A", "B"]).nullable(),
  duration_seconds: z.number().int().min(0).default(0),
  longest_rally_seconds: z.number().int().min(0).default(0),
  total_rallies: z.number().int().min(0).default(0),
  notes: z.string().max(500).optional(),
  tags: z.array(z.string().min(1).max(30)).max(10).default([]),
  opponent_nicknames: z.record(z.string(), z.string().max(40)).default({}),
  status: z.enum(["in_progress", "finished", "abandoned"]).default("finished"),
});

function isMissingMatchesColumn(error: { message?: string } | null | undefined, column: string) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    message.includes(column.toLowerCase()) &&
    (message.includes("schema cache") || message.includes("column"))
  );
}

function isMissingProfileColumn(error: { message?: string } | null | undefined, column: string) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    message.includes(column.toLowerCase()) &&
    (message.includes("schema cache") || message.includes("column"))
  );
}

function isMissingPreferenceColumn(error: { message?: string } | null | undefined, column: string) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    message.includes(column.toLowerCase()) &&
    (message.includes("schema cache") || message.includes("column"))
  );
}

async function handlesToIds(supabase: any, handles: string[]): Promise<string[]> {
  const cleaned = handles.map((h) => h.trim().replace(/^@/, "")).filter(Boolean);
  if (cleaned.length === 0) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("id, handle")
    .in("handle", cleaned);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => r.id);
}

export const saveMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => saveMatchInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [aIds, bIds] = await Promise.all([
      handlesToIds(supabase, data.team_a_handles),
      handlesToIds(supabase, data.team_b_handles),
    ]);
    // Ensure the creator is a participant so their RLS can read it back.
    const teamAUserIds = Array.from(new Set([userId, ...aIds]));
    const teamBUserIds = Array.from(new Set(bIds));
    const games_won_a = data.games.filter((g) => g.a > g.b).length;
    const games_won_b = data.games.filter((g) => g.b > g.a).length;
    const matchPayload = {
      creator_id: userId,
      mode: data.mode,
      category: data.category,
      title: data.title ?? null,
      court_name: data.court_name ?? null,
      format: data.format,
      points_to_win: data.points_to_win,
      best_of: data.best_of,
      team_a_names: data.team_a_names,
      team_b_names: data.team_b_names,
      team_a_user_ids: teamAUserIds,
      team_b_user_ids: teamBUserIds,
      games: data.games,
      games_won_a,
      games_won_b,
      winner: data.winner,
      duration_seconds: data.duration_seconds,
      longest_rally_seconds: data.longest_rally_seconds,
      total_rallies: data.total_rallies,
      notes: data.notes ?? null,
      tags: data.tags,
      opponent_nicknames: data.opponent_nicknames,
      status: data.status,
      finished_at: data.status === "finished" ? new Date().toISOString() : null,
    };
    let { data: row, error } = await supabase
      .from("matches")
      .insert(matchPayload)
      .select("id")
      .single();
    if (error && isMissingMatchesColumn(error, "category")) {
      // Keep scoreboard history usable while the remote PostgREST schema cache
      // catches up with the match-lobby migration. The new fields will be used
      // automatically as soon as the migration is applied.
      const legacyPayload = { ...matchPayload } as Record<string, unknown>;
      delete legacyPayload.category;
      delete legacyPayload.title;
      delete legacyPayload.court_name;
      ({ data: row, error } = await supabase
        .from("matches")
        .insert(legacyPayload as TablesInsert<"matches">)
        .select("id")
        .single());
    }
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Match was not saved.");
    if (data.status === "finished") {
      void awardProgressXp(supabase, userId, `match:${row.id}:saved`, "match", 10).catch(() => {});
      void completeReferralForUser(userId).catch(() => {});
    }
    // Fire-and-forget streak alert on a finished win
    if (data.status === "finished" && data.winner) {
      const userOnA = teamAUserIds.includes(userId);
      const userWon = (userOnA && data.winner === "A") || (!userOnA && data.winner === "B");
      if (userWon) {
        void checkAndSendStreakAlert(userId).catch(() => {});
      }
    }
    return { id: row.id };
  });

async function checkAndSendStreakAlert(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { sendToUser } = await import("@/lib/push.server");

  // Look at last 10 finished matches for the user
  const { data: recent } = await supabaseAdmin
    .from("matches")
    .select("winner, team_a_user_ids, team_b_user_ids, finished_at")
    .eq("status", "finished")
    .or(`team_a_user_ids.cs.{${userId}},team_b_user_ids.cs.{${userId}}`)
    .order("finished_at", { ascending: false })
    .limit(10);

  let streak = 0;
  for (const m of recent ?? []) {
    const onA = m.team_a_user_ids?.includes(userId);
    const won = (onA && m.winner === "A") || (!onA && m.winner === "B");
    if (won) streak++;
    else break;
  }
  if (streak < 3) return;

  // Respect user preference
  const { data: pref } = await supabaseAdmin
    .from("user_preferences")
    .select("notifications")
    .eq("id", userId)
    .maybeSingle();
  if ((pref?.notifications as any)?.win_streak_alerts === false) return;

  // Dedupe by streak count so each new streak length triggers once
  const bucket = `streak-${streak}`;
  const { data: already } = await supabaseAdmin
    .from("notification_log")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", "streak_alert")
    .eq("bucket", bucket)
    .maybeSingle();
  if (already) return;

  const emoji = streak >= 10 ? "🔥🔥" : streak >= 5 ? "🔥" : "⭐";
  await sendToUser(supabaseAdmin, userId, {
    title: `${streak}-win streak ${emoji}`,
    body: `You've won ${streak} matches in a row. Keep it going!`,
    url: "/history",
    tag: `streak-${streak}`,
  });
  await supabaseAdmin
    .from("notification_log")
    .insert({ user_id: userId, kind: "streak_alert", bucket });
}

export const listMyMatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("matches")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const deleteMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("matches").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const searchProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => z.object({ q: z.string().min(1).max(60) }).parse(raw))
  .handler(async ({ data, context }) => {
    const q = data.q.replace(/^@/, "");
    const { data: rows, error } = await context.supabase
      .from("profiles")
      .select("id, handle, display_name, avatar_url")
      .or(`handle.ilike.%${q}%,display_name.ilike.%${q}%`)
      .limit(10);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const headToHead = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => z.object({ opponentHandle: z.string().min(1) }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const handle = data.opponentHandle.trim().replace(/^@/, "");
    const { data: opp, error: oppErr } = await supabase
      .from("profiles")
      .select("id, handle, display_name, avatar_url")
      .eq("handle", handle)
      .maybeSingle();
    if (oppErr) throw new Error(oppErr.message);
    if (!opp) throw new Error("No player with that handle");
    const { data: h2h, error } = await supabase.rpc("head_to_head", {
      user_a: userId,
      user_b: opp.id,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(h2h) ? h2h[0] : h2h;
    return {
      opponent: opp,
      matches_played: Number(row?.matches_played ?? 0),
      wins_me: Number(row?.wins_a ?? 0),
      wins_them: Number(row?.wins_b ?? 0),
    };
  });

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) =>
    z
      .object({
        handle: z
          .string()
          .min(2)
          .max(24)
          .regex(/^[a-z0-9_]+$/, "lowercase letters, numbers, underscores"),
        display_name: z.string().min(1).max(60),
        // Avatars may be stored as a public URL or as a private Storage object path.
        avatar_url: z.string().max(500).nullable().optional(),
        bio: z.string().max(280).nullable().optional(),
        location: z.string().max(80).nullable().optional(),
        playing_hand: z.enum(["right", "left", "ambi"]).nullable().optional(),
        gender: z.enum(["male", "female"]).nullable().optional(),
        birthday: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Birthday must be a valid date")
          .nullable()
          .optional(),
        favorite_racket: z.string().max(80).nullable().optional(),
        home_court: z.string().max(80).nullable().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const profilePayload = {
      id: context.userId,
      handle: data.handle,
      display_name: data.display_name,
      avatar_url: data.avatar_url ?? null,
      bio: data.bio ?? null,
      location: data.location ?? null,
      playing_hand: data.playing_hand ?? null,
      favorite_racket: data.favorite_racket ?? null,
      home_court: data.home_court ?? null,
      gender: data.gender ?? null,
      birthday: data.birthday ?? null,
    };
    let { error } = await context.supabase
      .from("profiles")
      .upsert(profilePayload, { onConflict: "id" });
    // Retry without any newly-added profile columns that the remote schema cache does not know yet.
    let retryPayload: TablesInsert<"profiles"> = profilePayload;
    if (error && isMissingProfileColumn(error, "gender")) {
      const { gender: _gender, ...withoutGender } = retryPayload;
      void _gender;
      retryPayload = withoutGender;
      ({ error } = await context.supabase
        .from("profiles")
        .upsert(retryPayload, { onConflict: "id" }));
    }
    if (error && isMissingProfileColumn(error, "birthday")) {
      const { birthday: _birthday, ...withoutBirthday } = retryPayload;
      void _birthday;
      retryPayload = withoutBirthday;
      ({ error } = await context.supabase
        .from("profiles")
        .upsert(retryPayload, { onConflict: "id" }));
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const preferencesSchema = z.object({
  match_defaults: z
    .object({
      mode: z.enum(["singles", "doubles"]).optional(),
      format: z.string().max(40).optional(),
      points_to_win: z.number().int().positive().max(99).optional(),
      best_of: z.number().int().min(1).max(9).optional(),
      preset_id: z.string().max(40).optional(),
      starting_a: z.string().max(60).optional(),
      starting_b: z.string().max(60).optional(),
      court_color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
    })
    .default({}),
  dashboard: z
    .object({
      shortcuts: z
        .array(z.enum(["scoreboard", "ai", "video", "history", "profile", "settings"]))
        .max(6)
        .optional(),
      show_stats: z.boolean().optional(),
      show_h2h: z.boolean().optional(),
      show_streak: z.boolean().optional(),
      layout: z.enum(["compact", "balanced", "stats-heavy"]).optional(),
      coaching_tone: z.enum(["friendly", "competitive", "technical", "blunt"]).optional(),
      terminology: z
        .object({
          game: z.string().max(20).optional(),
          set: z.string().max(20).optional(),
          rally: z.string().max(20).optional(),
          match: z.string().max(20).optional(),
        })
        .optional(),
      goal: z
        .object({
          title: z.string().max(80),
          target: z.number().int().positive().max(1000),
          progress: z.number().int().min(0).max(1000),
          unit: z.string().max(30),
        })
        .optional(),
    })
    .default({}),
  notifications: z
    .object({
      match_reminders: z.boolean().optional(),
      weekly_summary: z.boolean().optional(),
      win_streak_alerts: z.boolean().optional(),
      quest_reminders: z.boolean().optional(),
      level_up_notifications: z.boolean().optional(),
      achievement_notifications: z.boolean().optional(),
      reminder_time: z.string().max(5).optional(),
      schedule_enabled: z.boolean().optional(),
      schedule_start: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional(),
      schedule_end: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional(),
      quiet_hours_enabled: z.boolean().optional(),
      quiet_hours_start: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional(),
      quiet_hours_end: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional(),
      timezone: z.string().max(80).optional(),
    })
    .default({}),
  accessibility: z
    .object({
      text_scale: z.enum(["normal", "large", "xlarge"]).optional(),
      color_blind_palette: z.boolean().optional(),
      high_contrast: z.boolean().optional(),
      reduced_motion: z.boolean().optional(),
      sound: z.boolean().optional(),
      haptics: z.boolean().optional(),
      voice: z.boolean().optional(),
    })
    .default({}),
  public_profile_enabled: z.boolean().default(false),
});

export const getMyPreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_preferences")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (
      data ?? {
        match_defaults: {},
        dashboard: {},
        notifications: {},
        accessibility: {},
        public_profile_enabled: false,
      }
    );
  });

export const updateMyPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => preferencesSchema.parse(raw))
  .handler(async ({ data, context }) => {
    let { data: existing, error: existingError } = await context.supabase
      .from("user_preferences")
      .select("match_defaults, dashboard, notifications, accessibility, public_profile_enabled")
      .eq("id", context.userId)
      .maybeSingle();
    if (existingError && isMissingPreferenceColumn(existingError, "accessibility")) {
      const legacy = await context.supabase
        .from("user_preferences")
        .select("match_defaults, dashboard, notifications, public_profile_enabled")
        .eq("id", context.userId)
        .maybeSingle();
      existing = legacy.data as any;
      existingError = legacy.error;
    }
    if (existingError) throw new Error(existingError.message);
    const current = (existing ?? {}) as Record<string, any>;
    const payload = {
      id: context.userId,
      match_defaults: { ...(current.match_defaults ?? {}), ...data.match_defaults },
      dashboard: { ...(current.dashboard ?? {}), ...data.dashboard },
      notifications: { ...(current.notifications ?? {}), ...data.notifications },
      accessibility: { ...(current.accessibility ?? {}), ...data.accessibility },
      public_profile_enabled:
        data.public_profile_enabled ?? current.public_profile_enabled ?? false,
    } as any;
    let { error } = await context.supabase.from("user_preferences").upsert(payload);
    if (error && isMissingPreferenceColumn(error, "accessibility")) {
      const { accessibility: _accessibility, ...legacyPayload } = payload;
      void _accessibility;
      ({ error } = await context.supabase.from("user_preferences").upsert(legacyPayload));
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getOnboardingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_preferences")
      .select("onboarded_at")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { onboarded: Boolean((data as any)?.onboarded_at) };
  });

const onboardingSchema = z.object({
  handle: z
    .string()
    .min(2)
    .max(24)
    .regex(/^[a-z0-9_]+$/, "lowercase letters, numbers, underscores"),
  display_name: z.string().min(1).max(60),
  location: z.string().max(80).nullable().optional(),
  playing_hand: z.enum(["right", "left", "ambi"]).nullable().optional(),
  favorite_racket: z.string().max(80).nullable().optional(),
  home_court: z.string().max(80).nullable().optional(),
  gender: z.enum(["male", "female"]).nullable().optional(),
  match_defaults: z
    .object({
      mode: z.enum(["singles", "doubles"]).optional(),
      format: z.string().max(40).optional(),
      points_to_win: z.number().int().positive().max(99).optional(),
      best_of: z.number().int().min(1).max(9).optional(),
      court_color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
    })
    .default({}),
  referral_code: z.string().max(80).nullable().optional(),
});

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => onboardingSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { error: pErr } = await context.supabase.from("profiles").upsert(
      {
        id: context.userId,
        handle: data.handle,
        display_name: data.display_name,
        location: data.location ?? null,
        playing_hand: data.playing_hand ?? null,
        favorite_racket: data.favorite_racket ?? null,
        home_court: data.home_court ?? null,
        gender: data.gender ?? null,
      },
      { onConflict: "id" },
    );
    if (pErr) throw new Error(pErr.message);

    const { data: existing } = await context.supabase
      .from("user_preferences")
      .select("match_defaults, dashboard, notifications")
      .eq("id", context.userId)
      .maybeSingle();

    const { error: prefErr } = await context.supabase.from("user_preferences").upsert({
      id: context.userId,
      match_defaults: { ...((existing as any)?.match_defaults ?? {}), ...data.match_defaults },
      dashboard: (existing as any)?.dashboard ?? {},
      notifications: (existing as any)?.notifications ?? {},
      onboarded_at: new Date().toISOString(),
    } as any);
    if (prefErr) throw new Error(prefErr.message);

    if (data.referral_code) {
      const db = context.supabase as any;
      const { data: referrer } = await db
        .from("profiles")
        .select("id")
        .eq("referral_code", data.referral_code)
        .maybeSingle();
      if (referrer && referrer.id !== context.userId) {
        await db.from("referrals").insert({
          referrer_id: referrer.id,
          referred_id: context.userId,
          referral_code: data.referral_code,
        });
      }
    }

    return { ok: true };
  });

export const updateMatchExtras = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        notes: z.string().max(500).nullable().optional(),
        tags: z.array(z.string().min(1).max(30)).max(10).optional(),
        opponent_nicknames: z.record(z.string(), z.string().max(40)).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const patch: {
      notes?: string | null;
      tags?: string[];
      opponent_nicknames?: Record<string, string>;
    } = {};
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.tags !== undefined) patch.tags = data.tags;
    if (data.opponent_nicknames !== undefined) patch.opponent_nicknames = data.opponent_nicknames;
    const { error } = await context.supabase.from("matches").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
