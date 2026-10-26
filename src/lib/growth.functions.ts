import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

async function hashToken(token: string) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(token).digest("hex");
}

export const getPublicProfile = createServerFn({ method: "GET" })
  .validator((raw: unknown) => z.object({ handle: z.string().min(2).max(24) }).parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: profile, error } = await db
      .from("profiles")
      .select("id, handle, display_name, avatar_url")
      .eq("handle", data.handle.toLowerCase().replace(/^@/, ""))
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!profile) return null;
    const { data: prefs } = await db
      .from("user_preferences")
      .select("public_profile_enabled")
      .eq("id", profile.id)
      .maybeSingle();
    if (!prefs?.public_profile_enabled) return { unavailable: true, handle: profile.handle };
    const { publicStats } = await import("@/lib/public-profile-stats.server");
    return { profile, stats: await publicStats(db, profile.id) };
  });

export const createMatchInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) =>
    z
      .object({
        match_id: uuid,
        team_side: z.enum(["A", "B"]),
        recipient_id: uuid.nullable().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: match, error: matchError } = await db
      .from("matches")
      .select("creator_id")
      .eq("id", data.match_id)
      .single();
    if (matchError || match?.creator_id !== context.userId)
      throw new Error("Only the match creator can create invitations.");
    const { randomBytes } = await import("node:crypto");
    const token = randomBytes(24).toString("hex");
    const tokenHash = await hashToken(token);
    const { data: row, error } = await db
      .from("match_invites")
      .insert({
        match_id: data.match_id,
        sender_id: context.userId,
        recipient_id: data.recipient_id ?? null,
        team_side: data.team_side,
        token_hash: tokenHash,
      })
      .select("id, expires_at")
      .single();
    if (error) throw new Error(error.message);
    return { ...row, token };
  });

export const listMatchInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const { data, error } = await db
      .from("match_invites")
      .select("id, match_id, sender_id, recipient_id, team_side, status, expires_at, created_at")
      .or(`sender_id.eq.${context.userId},recipient_id.eq.${context.userId}`)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const respondToMatchInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => z.object({ id: uuid, accept: z.boolean() }).strict().parse(raw))
  .handler(async ({ data, context }) => {
    const { respondToInvite } = await import("./invitations.server");
    const result = await respondToInvite(context.userId, { id: data.id, accept: data.accept });
    return data.accept
      ? { ok: true, accepted: true, match_id: result.match_id }
      : { ok: true, accepted: false };
  });

export const getInviteByToken = createServerFn({ method: "GET" })
  .validator((raw: unknown) => z.object({ token: z.string().min(20).max(100) }).parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const tokenHash = await hashToken(data.token);
    const { data: invite, error } = await db
      .from("match_invites")
      .select("id, match_id, sender_id, team_side, status, expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!invite) return null;
    if (invite.status !== "pending" || new Date(invite.expires_at).getTime() < Date.now())
      return { ...invite, unavailable: true };
    const { data: sender } = await db
      .from("profiles")
      .select("handle, display_name")
      .eq("id", invite.sender_id)
      .maybeSingle();
    return { ...invite, sender };
  });

export const acceptInviteToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) =>
    z
      .object({ token: z.string().min(20).max(100) })
      .strict()
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { respondToInvite } = await import("./invitations.server");
    const result = await respondToInvite(context.userId, {
      tokenHash: await hashToken(data.token),
      accept: true,
    });
    return { ok: true, match_id: result.match_id };
  });

export const getReferralStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("handle, referral_code")
      .eq("id", context.userId)
      .single();
    if (profileError) throw new Error(profileError.message);
    const { data: referrals, error } = await db
      .from("referrals")
      .select("id, referred_id, status, created_at, completed_at")
      .eq("referrer_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return {
      code: profile.referral_code ?? `${profile.handle}-${context.userId.slice(0, 8)}`,
      referrals: referrals ?? [],
    };
  });

export const attributeReferral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => z.object({ code: z.string().min(3).max(80) }).parse(raw))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: referrer } = await db
      .from("profiles")
      .select("id")
      .eq("referral_code", data.code)
      .maybeSingle();
    if (!referrer || referrer.id === context.userId) return { ok: false };
    const { error } = await db
      .from("referrals")
      .insert({ referrer_id: referrer.id, referred_id: context.userId, referral_code: data.code });
    if (error && error.code !== "23505") throw new Error(error.message);
    return { ok: true };
  });

export async function completeReferralForUser(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { awardProgressXp } = await import("@/lib/progress.server");
  const db = supabaseAdmin as any;
  const { data: referral } = await db
    .from("referrals")
    .select("id, referrer_id, status")
    .eq("referred_id", userId)
    .eq("status", "pending")
    .maybeSingle();
  if (!referral) return false;
  const { error } = await db
    .from("referrals")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", referral.id)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  await Promise.all([
    awardProgressXp(db, userId, `referral:${referral.id}:referred`, "referral", 100),
    awardProgressXp(db, referral.referrer_id, `referral:${referral.id}:referrer`, "referral", 100),
    db
      .from("player_achievements")
      .upsert(
        { user_id: userId, achievement_key: "community-builder", award_key: "referral" },
        { onConflict: "user_id,achievement_key" },
      ),
    db.from("player_achievements").upsert(
      {
        user_id: referral.referrer_id,
        achievement_key: "community-builder",
        award_key: "referral",
      },
      { onConflict: "user_id,achievement_key" },
    ),
  ]);
  return true;
}
