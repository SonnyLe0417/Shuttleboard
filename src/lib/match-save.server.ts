// RLS remains the authorization boundary; a duplicate never updates the saved result.
export async function insertOwnedMatch(db: any, userId: string, payload: Record<string, unknown>) {
  const result = await db.from("matches").insert(payload).select("id").single();
  if (result.error?.code === "23505" && typeof payload.id === "string") {
    const existing = await db
      .from("matches")
      .select("id,creator_id")
      .eq("id", payload.id)
      .eq("creator_id", userId)
      .maybeSingle();
    if (existing.error || !existing.data)
      throw Error("Match ID is unavailable. The local result has been retained.");
    return { data: { id: existing.data.id }, error: null, created: false };
  }
  return { ...result, created: !result.error && Boolean(result.data) };
}
