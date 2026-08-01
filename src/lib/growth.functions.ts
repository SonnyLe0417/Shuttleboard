import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { awardProgressXp } from "@/lib/progress.functions";

const uuid = z.string().uuid();

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function publicStats(db: any, userId: string) {
  const { data: matches, error } = await db
    .from("matches")
    .select("mode, winner, team_a_user_ids, team_b_user_ids, status")
    .eq("status", "finished")
    .or(`team_a_user_ids.cs.{${userId}},team_b_user_ids.cs.{${userId}}`)
    .order("finished_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = matches ?? [];
  let wins = 0;
  let streak = 0;
  for (const match of rows) {
    const onA = (match.team_a_user_ids ?? []).includes(userId);
    const won = (onA && match.winner === "A") || (!onA && match.winner === "B");
    if (won) wins++;
    if (won) streak++;
    else break;
  }
  const singles = rows.filter((m: any) => m.mode === "singles").length;
  const doubles = rows.filter((m: any) => m.mode === "doubles").length;
  return {
    matches: rows.length,
    wins,
    losses: Math.max(0, rows.length - wins),
    winRate: rows.length ? Math.round((wins / rows.length) * 100) : 0,
    currentStreak: streak,
    singles,
    doubles,
  };
}

export const getPublicProfile = createServerFn({ method: "GET" })
  .validator((raw: unknown) => z.object({ handle: z.string().min(2).max(24) }).parse(raw))
  .handler(async ({ data }) => {
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
    const token = randomBytes(24).toString("hex");
    const { data: row, error } = await db
      .from("match_invites")
      .insert({
        match_id: data.match_id,
        sender_id: context.userId,
        recipient_id: data.recipient_id ?? null,
        team_side: data.team_side,
        token_hash: hashToken(token),
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
  .validator((raw: unknown) => z.object({ id: uuid, accept: z.boolean() }).parse(raw))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: invite, error } = await db
      .from("match_invites")
      .select("*")
      .eq("id", data.id)
      .eq("recipient_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (
      !invite ||
      invite.status !== "pending" ||
      new Date(invite.expires_at).getTime() < Date.now()
    )
      throw new Error("This invitation is no longer available.");
    if (!data.accept) {
      await db.from("match_invites").update({ status: "declined" }).eq("id", invite.id);
      return { ok: true, accepted: false };
    }
    const { data: match, error: matchError } = await db
      .from("matches")
      .select("team_a_user_ids, team_b_user_ids")
      .eq("id", invite.match_id)
      .single();
    if (matchError) throw new Error(matchError.message);
    const field = invite.team_side === "A" ? "team_a_user_ids" : "team_b_user_ids";
    await db
      .from("matches")
      .update({ [field]: Array.from(new Set([...(match[field] ?? []), context.userId])) })
      .eq("id", invite.match_id);
    await db
      .from("match_invites")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", invite.id);
    return { ok: true, accepted: true, match_id: invite.match_id };
  });

export const getInviteByToken = createServerFn({ method: "GET" })
  .validator((raw: unknown) => z.object({ token: z.string().min(20).max(100) }).parse(raw))
  .handler(async ({ data }) => {
    const { data: invite, error } = await (supabaseAdmin as any)
      .from("match_invites")
      .select("id, match_id, sender_id, team_side, status, expires_at")
      .eq("token_hash", hashToken(data.token))
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!invite) return null;
    if (invite.status !== "pending" || new Date(invite.expires_at).getTime() < Date.now())
      return { ...invite, unavailable: true };
    const { data: sender } = await (supabaseAdmin as any)
      .from("profiles")
      .select("handle, display_name")
      .eq("id", invite.sender_id)
      .maybeSingle();
    return { ...invite, sender };
  });

export const acceptInviteToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => z.object({ token: z.string().min(20).max(100) }).parse(raw))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: invite, error } = await db
      .from("match_invites")
      .select("*")
      .eq("token_hash", hashToken(data.token))
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (
      !invite ||
      invite.status !== "pending" ||
      new Date(invite.expires_at).getTime() < Date.now()
    )
      throw new Error("This invitation is no longer available.");
    const { data: match, error: matchError } = await db
      .from("matches")
      .select("team_a_user_ids, team_b_user_ids")
      .eq("id", invite.match_id)
      .single();
    if (matchError) throw new Error(matchError.message);
    const field = invite.team_side === "A" ? "team_a_user_ids" : "team_b_user_ids";
    await db
      .from("matches")
      .update({ [field]: Array.from(new Set([...(match[field] ?? []), context.userId])) })
      .eq("id", invite.match_id);
    await db
      .from("match_invites")
      .update({
        status: "accepted",
        recipient_id: context.userId,
        accepted_at: new Date().toISOString(),
      })
      .eq("id", invite.id);
    return { ok: true, match_id: invite.match_id };
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
