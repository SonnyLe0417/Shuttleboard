import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Users,
  UserPlus,
  MessageSquare,
  Search,
  Check,
  X,
  Send,
  Loader2,
  UserRound,
  Trash2,
  Clock,
  Plus,
  UsersRound,
  Link2,
} from "lucide-react";
import {
  listFriendships,
  searchUsers,
  sendFriendRequest,
  respondFriendRequest,
  removeFriendship,
  listMessages,
  sendMessage,
  markMessagesRead,
  unreadCounts,
  listGroupChats,
  createGroupChat,
  listGroupMessages,
  sendGroupMessage,
} from "@/lib/social.functions";
import { createMatchInvite, listMatchInvites, respondToMatchInvite } from "@/lib/growth.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/social")({
  head: () => ({ meta: [{ title: "Community · ShuttleBoard" }] }),
  component: SocialPage,
});

type Tab = "friends" | "requests" | "messages" | "invites";

type Profile = { id: string; handle: string; display_name: string; avatar_url?: string | null };

type Friendship = {
  id: string;
  status: "pending" | "accepted" | "blocked";
  direction: "incoming" | "outgoing";
  other: Profile;
  created_at: string;
  updated_at: string;
};

type GroupChat = {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  members: Array<{ user_id: string; role: string; profile: Profile }>;
};

function SocialPage() {
  const [tab, setTab] = useState<Tab>("friends");
  const [activeChat, setActiveChat] = useState<Profile | null>(null);
  const [activeGroup, setActiveGroup] = useState<GroupChat | null>(null);

  const fetchFriendships = useServerFn(listFriendships);
  const fetchUnread = useServerFn(unreadCounts);
  const fetchGroups = useServerFn(listGroupChats);
  const fetchInvites = useServerFn(listMatchInvites);

  const friendshipsQ = useQuery({
    queryKey: ["social", "friendships"],
    queryFn: () => fetchFriendships(),
  });
  const unreadQ = useQuery({
    queryKey: ["social", "unread"],
    queryFn: () => fetchUnread(),
    refetchInterval: 30_000,
  });
  const groupsQ = useQuery({
    queryKey: ["social", "groups"],
    queryFn: () => fetchGroups(),
  });
  const invitesQ = useQuery({ queryKey: ["social", "invites"], queryFn: () => fetchInvites() });

  const accepted = (friendshipsQ.data ?? []).filter((f) => f.status === "accepted");
  const incoming = (friendshipsQ.data ?? []).filter(
    (f) => f.status === "pending" && f.direction === "incoming",
  );
  const outgoing = (friendshipsQ.data ?? []).filter(
    (f) => f.status === "pending" && f.direction === "outgoing",
  );
  const unread = unreadQ.data ?? {};
  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Users className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold">Community</h1>
          <p className="text-sm text-muted-foreground">Find players, connect, and chat.</p>
        </div>
      </header>

      <div className="flex items-center gap-1 rounded-full border border-white/10 bg-card/60 p-1 text-sm">
        <TabButton active={tab === "friends"} onClick={() => setTab("friends")}>
          <Users className="h-3.5 w-3.5" />
          Friends
          <Count value={accepted.length} />
        </TabButton>
        <TabButton active={tab === "requests"} onClick={() => setTab("requests")}>
          <UserPlus className="h-3.5 w-3.5" />
          Requests
          <Count value={incoming.length} highlight />
        </TabButton>
        <TabButton active={tab === "messages"} onClick={() => setTab("messages")}>
          <MessageSquare className="h-3.5 w-3.5" />
          Messages
          <Count value={totalUnread} highlight />
        </TabButton>
        <TabButton active={tab === "invites"} onClick={() => setTab("invites")}>
          <Link2 className="h-3.5 w-3.5" /> Invites{" "}
          <Count
            value={
              (invitesQ.data ?? []).filter((i: any) => i.recipient_id && i.status === "pending")
                .length
            }
            highlight
          />
        </TabButton>
      </div>

      {tab === "friends" && (
        <FriendsTab
          friends={accepted}
          loading={friendshipsQ.isLoading}
          onOpenChat={(p) => {
            setActiveChat(p);
            setTab("messages");
          }}
        />
      )}
      {tab === "requests" && (
        <RequestsTab incoming={incoming} outgoing={outgoing} loading={friendshipsQ.isLoading} />
      )}
      {tab === "messages" && (
        <MessagesTab
          friends={accepted}
          groups={(groupsQ.data ?? []) as GroupChat[]}
          unread={unread}
          activeChat={activeChat}
          setActiveChat={setActiveChat}
          activeGroup={activeGroup}
          setActiveGroup={setActiveGroup}
        />
      )}
      {tab === "invites" && <InvitesTab invites={(invitesQ.data ?? []) as any[]} />}
    </div>
  );
}

function InvitesTab({ invites }: { invites: any[] }) {
  const respond = useServerFn(respondToMatchInvite);
  const qc = useQueryClient();
  const incoming = invites.filter((invite) => invite.recipient_id && invite.status === "pending");
  const outgoing = invites.filter((invite) => invite.sender_id && invite.status === "pending");
  async function act(id: string, accept: boolean) {
    try {
      await respond({ data: { id, accept } });
      await qc.invalidateQueries({ queryKey: ["social", "invites"] });
      toast.success(accept ? "Match invitation accepted" : "Invitation declined");
    } catch (err: any) {
      toast.error(err.message ?? "Invitation update failed");
    }
  }
  return (
    <div className="space-y-4">
      <SectionCard title="Incoming invitations">
        {incoming.length === 0 ? (
          <Empty>No pending match invitations.</Empty>
        ) : (
          <ul className="space-y-2">
            {incoming.map((invite) => (
              <li
                key={invite.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-background/30 p-3"
              >
                <div>
                  <p className="text-sm font-semibold">Match invitation</p>
                  <p className="text-xs text-muted-foreground">
                    Join team {invite.team_side} · expires{" "}
                    {new Date(invite.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => act(invite.id, true)}
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => act(invite.id, false)}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs"
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard title="Sent invitations">
        <p className="text-xs text-muted-foreground">
          {outgoing.length
            ? `${outgoing.length} invitation${outgoing.length === 1 ? "" : "s"} awaiting a response.`
            : "No sent invitations."}
        </p>
      </SectionCard>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Count({ value, highlight }: { value: number; highlight?: boolean }) {
  if (!value) return null;
  return (
    <span
      className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        highlight ? "bg-primary text-primary-foreground" : "bg-white/10 text-foreground"
      }`}
    >
      {value}
    </span>
  );
}

// ---------- FRIENDS TAB ----------
function FriendsTab({
  friends,
  loading,
  onOpenChat,
}: {
  friends: Friendship[];
  loading: boolean;
  onOpenChat: (p: Profile) => void;
}) {
  const qc = useQueryClient();
  const remove = useServerFn(removeFriendship);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const searchFn = useServerFn(searchUsers);
  const sendReq = useServerFn(sendFriendRequest);
  const createInvite = useServerFn(createMatchInvite);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const searchQ = useQuery({
    queryKey: ["social", "search", debounced],
    queryFn: () => searchFn({ data: { q: debounced } }),
    enabled: debounced.length >= 1,
  });

  const knownIds = useMemo(() => new Set(friends.map((f) => f.other.id)), [friends]);

  async function handleAdd(id: string) {
    try {
      const res = await sendReq({ data: { addressee_id: id } });
      toast.success(res.status === "accepted" ? "You're now friends" : "Friend request sent");
      qc.invalidateQueries({ queryKey: ["social", "friendships"] });
    } catch (err: any) {
      toast.error(err.message ?? "Couldn't send request");
    }
  }

  async function handleRemove(id: string) {
    if (!confirm("Remove this friend?")) return;
    try {
      await remove({ data: { id } });
      qc.invalidateQueries({ queryKey: ["social", "friendships"] });
    } catch (err: any) {
      toast.error(err.message ?? "Couldn't remove");
    }
  }

  async function handleInvite(friendId: string) {
    const matchId = window.prompt("Paste the saved match ID to invite this friend:");
    if (!matchId) return;
    try {
      const invite = await createInvite({
        data: { match_id: matchId, team_side: "B", recipient_id: friendId },
      });
      toast.success(`Invitation sent. Link: ${window.location.origin}/invite/${invite.token}`);
    } catch (err: any) {
      toast.error(err.message ?? "Couldn't send invitation");
    }
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a player by @handle or name"
          className="w-full rounded-full border border-white/10 bg-card/60 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary/50"
        />
      </div>

      {debounced ? (
        <SectionCard title="Search results">
          {searchQ.isLoading ? (
            <RowSpinner />
          ) : (searchQ.data ?? []).length === 0 ? (
            <Empty>No players match "{debounced}"</Empty>
          ) : (
            <ul className="divide-y divide-white/5">
              {(searchQ.data ?? []).map((p: any) => (
                <UserRow
                  key={p.id}
                  profile={p}
                  right={
                    knownIds.has(p.id) ? (
                      <button
                        type="button"
                        onClick={() => handleInvite(p.id)}
                        className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"
                      >
                        <Link2 className="h-3 w-3" /> Invite
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAdd(p.id)}
                        className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                      >
                        <UserPlus className="h-3 w-3" /> Add
                      </button>
                    )
                  }
                />
              ))}
            </ul>
          )}
        </SectionCard>
      ) : null}

      <SectionCard title={`Your friends · ${friends.length}`}>
        {loading ? (
          <RowSpinner />
        ) : friends.length === 0 ? (
          <Empty>Search for a player above to send your first friend request.</Empty>
        ) : (
          <ul className="divide-y divide-white/5">
            {friends.map((f) => (
              <UserRow
                key={f.id}
                profile={f.other}
                right={
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onOpenChat(f.other)}
                      className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5 text-xs text-foreground hover:bg-white/5"
                    >
                      <MessageSquare className="h-3 w-3" /> Message
                    </button>
                    <button
                      onClick={() => handleRemove(f.id)}
                      className="rounded-full p-1.5 text-muted-foreground hover:text-destructive"
                      aria-label="Remove friend"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                }
              />
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

// ---------- REQUESTS TAB ----------
function RequestsTab({
  incoming,
  outgoing,
  loading,
}: {
  incoming: Friendship[];
  outgoing: Friendship[];
  loading: boolean;
}) {
  const qc = useQueryClient();
  const respond = useServerFn(respondFriendRequest);
  const cancel = useServerFn(removeFriendship);

  async function decide(id: string, accept: boolean) {
    try {
      await respond({ data: { id, accept } });
      toast.success(accept ? "Friend added" : "Request dismissed");
      qc.invalidateQueries({ queryKey: ["social", "friendships"] });
    } catch (err: any) {
      toast.error(err.message ?? "Couldn't update request");
    }
  }
  async function cancelOutgoing(id: string) {
    try {
      await cancel({ data: { id } });
      qc.invalidateQueries({ queryKey: ["social", "friendships"] });
    } catch (err: any) {
      toast.error(err.message ?? "Couldn't cancel");
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <SectionCard title={`Incoming · ${incoming.length}`}>
        {loading ? (
          <RowSpinner />
        ) : incoming.length === 0 ? (
          <Empty>No pending requests.</Empty>
        ) : (
          <ul className="divide-y divide-white/5">
            {incoming.map((f) => (
              <UserRow
                key={f.id}
                profile={f.other}
                right={
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => decide(f.id, true)}
                      className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                    >
                      <Check className="h-3 w-3" /> Accept
                    </button>
                    <button
                      onClick={() => decide(f.id, false)}
                      className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" /> Dismiss
                    </button>
                  </div>
                }
              />
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={`Sent · ${outgoing.length}`}>
        {loading ? (
          <RowSpinner />
        ) : outgoing.length === 0 ? (
          <Empty>You haven't sent any requests.</Empty>
        ) : (
          <ul className="divide-y divide-white/5">
            {outgoing.map((f) => (
              <UserRow
                key={f.id}
                profile={f.other}
                right={
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" /> Pending
                    <button
                      onClick={() => cancelOutgoing(f.id)}
                      className="rounded-full p-1.5 hover:text-destructive"
                      aria-label="Cancel request"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                }
              />
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

// ---------- MESSAGES TAB ----------
function MessagesTab({
  friends,
  groups,
  unread,
  activeChat,
  setActiveChat,
  activeGroup,
  setActiveGroup,
}: {
  friends: Friendship[];
  groups: GroupChat[];
  unread: Record<string, number>;
  activeChat: Profile | null;
  setActiveChat: (p: Profile | null) => void;
  activeGroup: GroupChat | null;
  setActiveGroup: (group: GroupChat | null) => void;
}) {
  const sorted = useMemo(
    () => [...friends].sort((a, b) => (unread[b.other.id] ?? 0) - (unread[a.other.id] ?? 0)),
    [friends, unread],
  );
  const [creatingGroup, setCreatingGroup] = useState(false);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
      <div className="space-y-3">
        <SectionCard title="Group chats" padded={false}>
          <div className="border-b border-white/5 p-2">
            <button
              onClick={() => setCreatingGroup((value) => !value)}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/20"
            >
              <Plus className="h-3.5 w-3.5" /> New group chat
            </button>
          </div>
          {creatingGroup && (
            <CreateGroupForm
              friends={friends}
              onCancel={() => setCreatingGroup(false)}
              onCreated={(group) => {
                setCreatingGroup(false);
                setActiveChat(null);
                setActiveGroup(group);
              }}
            />
          )}
          {groups.length === 0 ? (
            <div className="p-3">
              <Empty>
                Create a group for league nights, training partners, or your regular court crew.
              </Empty>
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {groups.map((group) => (
                <li key={group.id}>
                  <button
                    onClick={() => {
                      setActiveGroup(group);
                      setActiveChat(null);
                    }}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition ${activeGroup?.id === group.id ? "bg-primary/10" : "hover:bg-white/5"}`}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                      <UsersRound className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{group.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {group.members.length} players
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Friends" padded={false}>
          {sorted.length === 0 ? (
            <div className="p-4">
              <Empty>Add a friend to start a chat.</Empty>
            </div>
          ) : (
            <ul className="max-h-[360px] overflow-y-auto divide-y divide-white/5">
              {sorted.map((f) => {
                const u = unread[f.other.id] ?? 0;
                const isActive = activeChat?.id === f.other.id;
                return (
                  <li key={f.id}>
                    <button
                      onClick={() => {
                        setActiveChat(f.other);
                        setActiveGroup(null);
                      }}
                      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition ${isActive ? "bg-primary/10" : "hover:bg-white/5"}`}
                    >
                      <Avatar profile={f.other} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {f.other.display_name || f.other.handle}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">@{f.other.handle}</p>
                      </div>
                      {u > 0 && (
                        <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                          {u}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title={
          activeGroup
            ? activeGroup.name
            : activeChat
              ? `Chat with ${activeChat.display_name || activeChat.handle}`
              : "Messages"
        }
        padded={false}
      >
        {activeGroup ? (
          <GroupChatPanel group={activeGroup} />
        ) : activeChat ? (
          <ChatPanel other={activeChat} />
        ) : (
          <div className="flex h-[520px] items-center justify-center p-6 text-center">
            <Empty>Select a friend from the list to open your conversation.</Empty>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function CreateGroupForm({
  friends,
  onCancel,
  onCreated,
}: {
  friends: Friendship[];
  onCancel: () => void;
  onCreated: (group: GroupChat) => void;
}) {
  const create = useServerFn(createGroupChat);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !selected.length || saving) return;
    setSaving(true);
    try {
      const group = await create({ data: { name: name.trim(), member_ids: selected } });
      await qc.invalidateQueries({ queryKey: ["social", "groups"] });
      const profiles = friends
        .filter((friend) => selected.includes(friend.other.id))
        .map((friend) => ({ user_id: friend.other.id, role: "member", profile: friend.other }));
      onCreated({ ...group, members: profiles } as GroupChat);
      toast.success("Group chat created");
    } catch (err: any) {
      toast.error(err.message ?? "Couldn't create group chat");
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3 border-b border-white/5 bg-background/30 p-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Group name, e.g. Friday League"
        maxLength={80}
        className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
      />
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Choose friends
        </p>
        <div className="max-h-40 space-y-1 overflow-y-auto">
          {friends.map((friend) => (
            <label
              key={friend.other.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-white/5"
            >
              <input
                type="checkbox"
                checked={selected.includes(friend.other.id)}
                onChange={(e) =>
                  setSelected((current) =>
                    e.target.checked
                      ? [...current, friend.other.id]
                      : current.filter((id) => id !== friend.other.id),
                  )
                }
                className="accent-primary"
              />
              <span className="truncate">{friend.other.display_name || friend.other.handle}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || !name.trim() || !selected.length}
          className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create group"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-white/10 px-3 py-2 text-xs text-muted-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function GroupChatPanel({ group }: { group: GroupChat }) {
  const qc = useQueryClient();
  const fetchMessages = useServerFn(listGroupMessages);
  const sendFn = useServerFn(sendGroupMessage);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [meId, setMeId] = useState("");
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? ""));
  }, []);
  const messagesQ = useQuery({
    queryKey: ["social", "group-messages", group.id],
    queryFn: () => fetchMessages({ data: { group_id: group.id } }),
    refetchInterval: 8_000,
  });
  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }, [messagesQ.data]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await sendFn({ data: { group_id: group.id, body: trimmed } });
      setBody("");
      qc.invalidateQueries({ queryKey: ["social", "group-messages", group.id] });
    } catch (err: any) {
      toast.error(err.message ?? "Message failed");
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="flex h-[520px] flex-col">
      <div className="border-b border-white/5 px-4 py-3">
        <p className="text-xs text-muted-foreground">
          {group.members
            .map((member) => member.profile.display_name || member.profile.handle)
            .join(" · ")}
        </p>
      </div>
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-4">
        {messagesQ.isLoading ? (
          <RowSpinner />
        ) : (messagesQ.data ?? []).length === 0 ? (
          <Empty>Start the conversation with your group.</Empty>
        ) : (
          (messagesQ.data ?? []).map((message: any) => {
            const mine = message.sender_id === meId;
            return (
              <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-primary text-primary-foreground" : "bg-white/5 text-foreground"}`}
                >
                  <p
                    className={`mb-1 text-[10px] font-semibold ${mine ? "text-primary-foreground/70" : "text-primary"}`}
                  >
                    {mine
                      ? "You"
                      : message.sender?.display_name || message.sender?.handle || "Player"}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  <p
                    className={`mt-1 text-[10px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                  >
                    {new Date(message.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
      <form onSubmit={submit} className="flex items-center gap-2 border-t border-white/5 p-3">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Message ${group.name}`}
          maxLength={2000}
          className="flex-1 rounded-full border border-white/10 bg-background px-4 py-2 text-sm outline-none focus:border-primary/50"
        />
        <button
          type="submit"
          disabled={sending || !body.trim()}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

function ChatPanel({ other }: { other: Profile }) {
  const qc = useQueryClient();
  const fetchMessages = useServerFn(listMessages);
  const sendFn = useServerFn(sendMessage);
  const markRead = useServerFn(markMessagesRead);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [meId, setMeId] = useState<string>("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? ""));
  }, []);

  const messagesQ = useQuery({
    queryKey: ["social", "messages", other.id],
    queryFn: () => fetchMessages({ data: { other_id: other.id } }),
    refetchInterval: 8_000,
  });

  useEffect(() => {
    if (!messagesQ.data) return;
    markRead({ data: { other_id: other.id } })
      .then(() => qc.invalidateQueries({ queryKey: ["social", "unread"] }))
      .catch(() => {});
    // scroll to bottom on new messages
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [messagesQ.data, other.id, markRead, qc]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await sendFn({ data: { recipient_id: other.id, body: trimmed } });
      setBody("");
      qc.invalidateQueries({ queryKey: ["social", "messages", other.id] });
    } catch (err: any) {
      toast.error(err.message ?? "Message failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[520px] flex-col">
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-4">
        {messagesQ.isLoading ? (
          <RowSpinner />
        ) : (messagesQ.data ?? []).length === 0 ? (
          <Empty>Say hi 👋</Empty>
        ) : (
          (messagesQ.data ?? []).map((m: any) => {
            const mine = m.sender_id === meId;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    mine ? "bg-primary text-primary-foreground" : "bg-white/5 text-foreground"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p
                    className={`mt-1 text-[10px] ${
                      mine ? "text-primary-foreground/70" : "text-muted-foreground"
                    }`}
                  >
                    {new Date(m.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
      <form onSubmit={submit} className="flex items-center gap-2 border-t border-white/5 p-3">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Message @${other.handle}`}
          maxLength={2000}
          className="flex-1 rounded-full border border-white/10 bg-background px-4 py-2 text-sm outline-none focus:border-primary/50"
        />
        <button
          type="submit"
          disabled={sending || !body.trim()}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
          aria-label="Send"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}

// ---------- Shared bits ----------
function SectionCard({
  title,
  padded = true,
  children,
}: {
  title: string;
  padded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-card/60 backdrop-blur">
      <div className="border-b border-white/5 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className={padded ? "p-2" : ""}>{children}</div>
    </div>
  );
}

function UserRow({ profile, right }: { profile: Profile; right?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-2">
      <Avatar profile={profile} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{profile.display_name || profile.handle}</p>
        <p className="truncate text-xs text-muted-foreground">@{profile.handle}</p>
      </div>
      {right}
    </li>
  );
}

function Avatar({ profile }: { profile: Profile }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-primary">
      {profile.avatar_url ? (
        <img src={profile.avatar_url} alt="" className="h-9 w-9 object-cover" />
      ) : (
        <UserRound className="h-4 w-4" />
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>;
}

function RowSpinner() {
  return (
    <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
  );
}
