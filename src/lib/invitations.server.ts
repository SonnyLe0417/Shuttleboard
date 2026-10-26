import { supabaseAdmin } from "@/integrations/supabase/client.server";
export async function respondToInvite(
  actorId: string,
  request: { id?: string; tokenHash?: string; accept: boolean },
  db: any = supabaseAdmin,
) {
  const { data, error } = await db.rpc("respond_to_match_invite", {
    p_actor_id: actorId,
    p_invite_id: request.id ?? null,
    p_token_hash: request.tokenHash ?? null,
    p_accept: request.accept,
  });
  if (error) throw new Error(error.message || "Invitation could not be updated.");
  if (data?.ok !== true || data.accepted !== request.accept || typeof data.match_id !== "string")
    throw new Error("Invitation was not updated.");
  return data as { ok: true; accepted: boolean; match_id: string };
}
