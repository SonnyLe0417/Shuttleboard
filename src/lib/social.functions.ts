import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

// -------- Search users --------
export const searchUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => z.object({ q: z.string().min(1).max(60) }).parse(raw))
  .handler(async ({ data, context }) => {
    const term = data.q.trim().replace(/^@/, "").toLowerCase();
    if (!term) return [];
    const { data: rows, error } = await context.supabase
      .from("profiles")
      .select("id, handle, display_name, avatar_url")
      .or(`handle.ilike.%${term}%,display_name.ilike.%${term}%`)
      .neq("id", context.userId)
      .limit(15);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// -------- Friendships --------
export const listFriendships = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase
      .from("friendships")
      .select("id, requester_id, addressee_id, status, created_at, updated_at")
      .or(`requester_id.eq.${context.userId},addressee_id.eq.${context.userId}`)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);

    const otherIds = Array.from(
      new Set(
        (rows ?? []).map((r: any) =>
          r.requester_id === context.userId ? r.addressee_id : r.requester_id,
        ),
      ),
    );
    let profilesById: Record<string, any> = {};
    if (otherIds.length) {
      const { data: profiles, error: pErr } = await context.supabase
        .from("profiles")
        .select("id, handle, display_name, avatar_url")
        .in("id", otherIds);
      if (pErr) throw new Error(pErr.message);
      profilesById = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));
    }

    const meId = context.userId;
    return (rows ?? []).map((r: any) => {
      const otherId = r.requester_id === meId ? r.addressee_id : r.requester_id;
      const direction: "incoming" | "outgoing" = r.requester_id === meId ? "outgoing" : "incoming";
      return {
        id: r.id,
        status: r.status as "pending" | "accepted" | "blocked",
        direction,
        other: profilesById[otherId] ?? { id: otherId, handle: "", display_name: "" },
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    });
  });

export const sendFriendRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => z.object({ addressee_id: uuid }).parse(raw))
  .handler(async ({ data, context }) => {
    if (data.addressee_id === context.userId) {
      throw new Error("You can't friend yourself");
    }
    // Check for an existing row either direction
    const { data: existing, error: exErr } = await context.supabase
      .from("friendships")
      .select("id, requester_id, addressee_id, status")
      .or(
        `and(requester_id.eq.${context.userId},addressee_id.eq.${data.addressee_id}),and(requester_id.eq.${data.addressee_id},addressee_id.eq.${context.userId})`,
      )
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);

    if (existing) {
      if (existing.status === "accepted") return { ok: true, status: "accepted" };
      // If they previously requested us, accept it
      if (existing.status === "pending" && existing.addressee_id === context.userId) {
        const { error } = await context.supabase
          .from("friendships")
          .update({ status: "accepted" })
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
        return { ok: true, status: "accepted" };
      }
      return { ok: true, status: existing.status };
    }

    const { error } = await context.supabase.from("friendships").insert({
      requester_id: context.userId,
      addressee_id: data.addressee_id,
      status: "pending",
    });
    if (error) throw new Error(error.message);
    return { ok: true, status: "pending" };
  });

export const respondFriendRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => z.object({ id: uuid, accept: z.boolean() }).parse(raw))
  .handler(async ({ data, context }) => {
    if (!data.accept) {
      const { error } = await context.supabase
        .from("friendships")
        .delete()
        .eq("id", data.id)
        .eq("addressee_id", context.userId);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { error } = await context.supabase
      .from("friendships")
      .update({ status: "accepted" })
      .eq("id", data.id)
      .eq("addressee_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeFriendship = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => z.object({ id: uuid }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("friendships").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- Group chats --------
const groupInput = z.object({
  name: z.string().trim().min(1).max(80),
  member_ids: z.array(uuid).min(1).max(20),
});

export const listGroupChats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: memberships, error: membershipError } = await context.supabase
      .from("chat_group_members")
      .select("group_id")
      .eq("user_id", context.userId);
    if (membershipError) throw new Error(membershipError.message);
    const groupIds = (memberships ?? []).map((row: any) => row.group_id);
    if (!groupIds.length) return [];

    const [{ data: groups, error: groupsError }, { data: members, error: membersError }] =
      await Promise.all([
        context.supabase
          .from("chat_groups")
          .select("id, name, owner_id, created_at")
          .in("id", groupIds)
          .order("created_at", { ascending: false }),
        context.supabase
          .from("chat_group_members")
          .select("group_id, user_id, role")
          .in("group_id", groupIds),
      ]);
    if (groupsError) throw new Error(groupsError.message);
    if (membersError) throw new Error(membersError.message);

    const userIds = Array.from(new Set((members ?? []).map((row: any) => row.user_id)));
    const { data: profiles, error: profilesError } = userIds.length
      ? await context.supabase
          .from("profiles")
          .select("id, handle, display_name, avatar_url")
          .in("id", userIds)
      : { data: [], error: null };
    if (profilesError) throw new Error(profilesError.message);
    const profilesById = Object.fromEntries(
      (profiles ?? []).map((profile: any) => [profile.id, profile]),
    );

    return (groups ?? []).map((group: any) => ({
      ...group,
      members: (members ?? [])
        .filter((member: any) => member.group_id === group.id)
        .map((member: any) => ({
          ...member,
          profile: profilesById[member.user_id] ?? {
            id: member.user_id,
            handle: "",
            display_name: "",
          },
        })),
    }));
  });

export const createGroupChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => groupInput.parse(raw))
  .handler(async ({ data, context }) => {
    const memberIds = Array.from(new Set(data.member_ids.filter((id) => id !== context.userId)));
    if (!memberIds.length) throw new Error("Choose at least one other player.");

    const { data: friendships, error: friendshipError } = await context.supabase
      .from("friendships")
      .select("requester_id, addressee_id")
      .eq("status", "accepted")
      .or(`requester_id.eq.${context.userId},addressee_id.eq.${context.userId}`);
    if (friendshipError) throw new Error(friendshipError.message);
    const friendIds = new Set(
      (friendships ?? []).map((row: any) =>
        row.requester_id === context.userId ? row.addressee_id : row.requester_id,
      ),
    );
    if (memberIds.some((id) => !friendIds.has(id)))
      throw new Error("Group chats can only include accepted friends.");

    const { data: group, error: groupError } = await context.supabase
      .from("chat_groups")
      .insert({ name: data.name, owner_id: context.userId })
      .select("id, name, owner_id, created_at")
      .single();
    if (groupError) throw new Error(groupError.message);

    const { error: memberError } = await context.supabase
      .from("chat_group_members")
      .insert([
        { group_id: group.id, user_id: context.userId, role: "owner" },
        ...memberIds.map((userId) => ({ group_id: group.id, user_id: userId, role: "member" })),
      ]);
    if (memberError) {
      await context.supabase.from("chat_groups").delete().eq("id", group.id);
      throw new Error(memberError.message);
    }
    return { ...group, member_ids: [context.userId, ...memberIds] };
  });

export const listGroupMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => z.object({ group_id: uuid }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("group_messages")
      .select("id, group_id, sender_id, body, created_at")
      .eq("group_id", data.group_id)
      .order("created_at", { ascending: true })
      .limit(300);
    if (error) throw new Error(error.message);
    const senderIds = Array.from(new Set((rows ?? []).map((row: any) => row.sender_id)));
    const { data: profiles, error: profilesError } = senderIds.length
      ? await context.supabase
          .from("profiles")
          .select("id, handle, display_name, avatar_url")
          .in("id", senderIds)
      : { data: [], error: null };
    if (profilesError) throw new Error(profilesError.message);
    const profilesById = Object.fromEntries(
      (profiles ?? []).map((profile: any) => [profile.id, profile]),
    );
    return (rows ?? []).map((row: any) => ({
      ...row,
      sender: profilesById[row.sender_id] ?? null,
    }));
  });

export const sendGroupMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) =>
    z.object({ group_id: uuid, body: z.string().trim().min(1).max(2000) }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("group_messages")
      .insert({ group_id: data.group_id, sender_id: context.userId, body: data.body })
      .select("id, group_id, sender_id, body, created_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// -------- Messages --------
export const listMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => z.object({ other_id: uuid }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("direct_messages")
      .select("id, sender_id, recipient_id, body, read_at, created_at")
      .or(
        `and(sender_id.eq.${context.userId},recipient_id.eq.${data.other_id}),and(sender_id.eq.${data.other_id},recipient_id.eq.${context.userId})`,
      )
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) =>
    z.object({ recipient_id: uuid, body: z.string().trim().min(1).max(2000) }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("direct_messages")
      .insert({
        sender_id: context.userId,
        recipient_id: data.recipient_id,
        body: data.body,
      })
      .select("id, sender_id, recipient_id, body, read_at, created_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const markMessagesRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => z.object({ other_id: uuid }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("direct_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", context.userId)
      .eq("sender_id", data.other_id)
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unreadCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase
      .from("direct_messages")
      .select("sender_id")
      .eq("recipient_id", context.userId)
      .is("read_at", null);
    if (error) throw new Error(error.message);
    const map: Record<string, number> = {};
    for (const r of rows ?? []) {
      map[(r as any).sender_id] = (map[(r as any).sender_id] ?? 0) + 1;
    }
    return map;
  });
