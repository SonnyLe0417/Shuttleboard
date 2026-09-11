import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const privacySchema = z.object({
  visibility: z.enum(["friends", "private"]).default("friends"),
  share_achievements: z.boolean().default(true),
  share_streaks: z.boolean().default(true),
  hide_personal_bests: z.boolean().default(true),
});

const DEFAULT_PRIVACY = {
  visibility: "friends" as const,
  share_achievements: true,
  share_streaks: true,
  hide_personal_bests: true,
};

function isMissingTable(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(
    error &&
    (error.code === "42P01" ||
      /schema cache|could not find the table|relation .* does not exist/i.test(
        error.message ?? "",
      )),
  );
}

export const getMyPrivacy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const { data, error } = await db
      .from("profile_privacy")
      .select("visibility, share_achievements, share_streaks, hide_personal_bests")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error && !isMissingTable(error)) throw new Error(error.message);
    return data ? privacySchema.parse(data) : DEFAULT_PRIVACY;
  });

export const updateMyPrivacy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => privacySchema.parse(raw))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { error } = await db.from("profile_privacy").upsert({
      user_id: context.userId,
      ...data,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const getVisiblePlayerProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => z.object({ user_id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const isOwner = data.user_id === context.userId;
    const db = context.supabase as any;
    if (!isOwner) {
      const { data: friendship, error: friendshipError } = await db
        .from("friendships")
        .select("id")
        .eq("status", "accepted")
        .or(
          `and(requester_id.eq.${context.userId},addressee_id.eq.${data.user_id}),and(requester_id.eq.${data.user_id},addressee_id.eq.${context.userId})`,
        )
        .maybeSingle();
      if (friendshipError) throw new Error(friendshipError.message);
      if (!friendship) throw new Error("This player's progress is private.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { data: privacy } = await admin
      .from("profile_privacy")
      .select("visibility, share_achievements, share_streaks, hide_personal_bests")
      .eq("user_id", data.user_id)
      .maybeSingle();
    const effectivePrivacy = { ...DEFAULT_PRIVACY, ...(privacy ?? {}) };
    if (!isOwner && effectivePrivacy.visibility === "private") {
      throw new Error("This player's progress is private.");
    }

    const [progressResult, achievementsResult, bestsResult, matchesResult] = await Promise.all([
      admin
        .from("player_progress")
        .select("total_xp, current_level")
        .eq("user_id", data.user_id)
        .maybeSingle(),
      admin
        .from("player_achievements")
        .select("achievement_key, award_key, earned_at")
        .eq("user_id", data.user_id)
        .order("earned_at", { ascending: false }),
      admin
        .from("personal_bests")
        .select("*")
        .eq("user_id", data.user_id)
        .order("achieved_at", { ascending: false }),
      admin
        .from("matches")
        .select("winner, team_a_user_ids, team_b_user_ids, status, finished_at")
        .eq("status", "finished")
        .or(`team_a_user_ids.cs.{${data.user_id}},team_b_user_ids.cs.{${data.user_id}}`)
        .order("finished_at", { ascending: false })
        .limit(100),
    ]);
    if (progressResult.error) throw new Error(progressResult.error.message);
    if (achievementsResult.error) throw new Error(achievementsResult.error.message);
    if (matchesResult.error) throw new Error(matchesResult.error.message);

    let currentStreak = 0;
    for (const match of matchesResult.data ?? []) {
      const onA = (match.team_a_user_ids ?? []).includes(data.user_id);
      const won = (onA && match.winner === "A") || (!onA && match.winner === "B");
      if (!won) break;
      currentStreak += 1;
    }

    return {
      progress: progressResult.data ?? { total_xp: 0, current_level: 1 },
      achievements:
        isOwner || effectivePrivacy.share_achievements ? (achievementsResult.data ?? []) : [],
      current_streak: isOwner || effectivePrivacy.share_streaks ? currentStreak : null,
      personal_bests:
        isOwner || !effectivePrivacy.hide_personal_bests ? (bestsResult.data ?? []) : [],
    };
  });

async function readRows(db: any, table: string, build: (query: any) => Promise<any>) {
  const { data, error } = await build(db.from(table));
  if (error && !isMissingTable(error)) throw new Error(error.message);
  return data ?? [];
}

export const exportMyAccountData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const userId = context.userId;

    const [
      profile,
      preferences,
      privacy,
      matches,
      reflections,
      memories,
      insights,
      quests,
      bests,
      progress,
      rewards,
      achievements,
      friendships,
    ] = await Promise.all([
      readRows(db, "profiles", (query) => query.select("*").eq("id", userId).maybeSingle()),
      readRows(db, "user_preferences", (query) => query.select("*").eq("id", userId).maybeSingle()),
      readRows(db, "profile_privacy", (query) =>
        query.select("*").eq("user_id", userId).maybeSingle(),
      ),
      readRows(db, "matches", (query) =>
        query.select("*").eq("creator_id", userId).order("started_at", { ascending: false }),
      ),
      readRows(db, "match_reflections", (query) =>
        query.select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      ),
      readRows(db, "opponent_memories", (query) =>
        query.select("*").eq("user_id", userId).order("updated_at", { ascending: false }),
      ),
      readRows(db, "player_insights", (query) =>
        query.select("*").eq("user_id", userId).maybeSingle(),
      ),
      readRows(db, "coach_quests", (query) =>
        query.select("*").eq("user_id", userId).order("starts_at", { ascending: false }),
      ),
      readRows(db, "personal_bests", (query) =>
        query.select("*").eq("user_id", userId).order("achieved_at", { ascending: false }),
      ),
      readRows(db, "player_progress", (query) =>
        query.select("*").eq("user_id", userId).maybeSingle(),
      ),
      readRows(db, "reward_events", (query) =>
        query.select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      ),
      readRows(db, "player_achievements", (query) =>
        query.select("*").eq("user_id", userId).order("earned_at", { ascending: false }),
      ),
      readRows(db, "friendships", (query) =>
        query
          .select("id, requester_id, addressee_id, status, created_at, updated_at")
          .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
      ),
    ]);

    return {
      schema_version: 1,
      exported_at: new Date().toISOString(),
      profile,
      preferences,
      privacy: privacy || DEFAULT_PRIVACY,
      matches,
      reflections,
      opponent_memories: memories,
      player_insights: insights,
      coach_quests: quests,
      personal_bests: bests,
      player_progress: progress,
      reward_events: rewards,
      achievements,
      friendships,
      // Push endpoints and auth credentials are intentionally excluded.
    };
  });

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) =>
    z
      .object({
        confirmation: z.literal("DELETE MY ACCOUNT"),
        password: z.string().min(1).max(256).optional(),
      })
      .strict()
      .parse(raw),
  )
  .handler(async ({ context, data }) => {
    const { deleteAuthenticatedAccount } = await import("@/lib/account-deletion.server");
    return deleteAuthenticatedAccount(context, data.password);
  });
