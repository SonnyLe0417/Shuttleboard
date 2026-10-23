import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  getMyProfile,
  updateMyProfile,
  getMyPreferences,
  updateMyPreferences,
} from "@/lib/matches.functions";
import { getProgressSummary } from "@/lib/progress.functions";
import { listFriendships } from "@/lib/social.functions";
import { getReferralStatus } from "@/lib/growth.functions";
import { ProfileProgressHome } from "@/components/profile/ProfileProgressHome";
import { useSession } from "@/hooks/useSession";
import {
  Loader2,
  LogOut,
  User,
  Link2,
  Check,
  Upload,
  Save,
  Sliders,
  LayoutDashboard,
  Bell,
  BellOff,
  BellRing,
  Trophy,
  Sparkles,
  Camera,
  Video as VideoIcon,
  History as HistoryIcon,
  UserRound,
  Settings as SettingsIcon,
} from "lucide-react";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { sendTestPush } from "@/lib/push.functions";
import { AvatarCropper } from "@/components/AvatarCropper";
import { Palette as PaletteIcon } from "lucide-react";
import { invalidateDashboard, PREFERENCES_QUERY_KEY, PROFILE_QUERY_KEY } from "@/lib/query-keys";

const PROFILE_GENDER_KEY = "shuttleboard.profile-gender.v1";
const PROFILE_BIRTHDAY_KEY = "shuttleboard.profile-birthday.v1";
const PROFILE_BANNER_KEY = "shuttleboard.profile-banner.v1";
const PROFILE_COURT_KEY = "shuttleboard.profile-court-photo.v1";

type MatchDefaults = {
  mode?: "singles" | "doubles";
  format?: string;
  points_to_win?: number;
  best_of?: number;
  starting_a?: string;
  starting_b?: string;
  court_color?: string;
};

type Dashboard = {
  shortcuts?: Array<"scoreboard" | "ai" | "video" | "history" | "profile" | "settings">;
  show_stats?: boolean;
  show_h2h?: boolean;
  show_streak?: boolean;
  layout?: "compact" | "balanced" | "stats-heavy";
  coaching_tone?: "friendly" | "competitive" | "technical" | "blunt";
  terminology?: { game?: string; set?: string; rally?: string; match?: string };
};

type Notifications = {
  match_reminders?: boolean;
  weekly_summary?: boolean;
  win_streak_alerts?: boolean;
  reminder_time?: string;
};

type EditSection = "profile" | "appearance" | "match" | "dashboard" | "notifications" | "account";

const ALL_SHORTCUTS: Array<{
  id: NonNullable<Dashboard["shortcuts"]>[number];
  label: string;
  icon: React.ReactNode;
}> = [
  { id: "scoreboard", label: "Scoreboard", icon: <Trophy className="h-3.5 w-3.5" /> },
  { id: "ai", label: "AI Referee", icon: <Camera className="h-3.5 w-3.5" /> },
  { id: "video", label: "Video", icon: <VideoIcon className="h-3.5 w-3.5" /> },
  { id: "history", label: "History", icon: <HistoryIcon className="h-3.5 w-3.5" /> },
  { id: "profile", label: "Profile", icon: <UserRound className="h-3.5 w-3.5" /> },
  { id: "settings", label: "Settings", icon: <SettingsIcon className="h-3.5 w-3.5" /> },
];

async function resolveAvatar(url: string | null): Promise<string> {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  const { data } = await supabase.storage.from("avatars").createSignedUrl(url, 60 * 60 * 24 * 7);
  return data?.signedUrl ?? "";
}

export function ProfilePage({ forceEditing = false }: { forceEditing?: boolean } = {}) {
  const editMode =
    forceEditing ||
    (typeof window !== "undefined" &&
      window.location.pathname.replace(/\/$/, "") === "/profile/edit");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useSession();
  const fetchProfile = useServerFn(getMyProfile);
  const saveProfile = useServerFn(updateMyProfile);
  const fetchPrefs = useServerFn(getMyPreferences);
  const savePrefs = useServerFn(updateMyPreferences);
  const fetchProgress = useServerFn(getProgressSummary);
  const fetchFriends = useServerFn(listFriendships);
  const fetchReferrals = useServerFn(getReferralStatus);

  const {
    data: profile,
    isLoading,
    isError: profileError,
    refetch,
  } = useQuery({
    queryKey: ["me", "profile"],
    queryFn: () => fetchProfile(),
  });
  const {
    data: prefs,
    isLoading: prefsLoading,
    isError: prefsError,
    refetch: refetchPrefs,
  } = useQuery({
    queryKey: ["me", "preferences"],
    queryFn: () => fetchPrefs(),
  });
  const progressQ = useQuery({
    queryKey: ["progress", "summary"],
    queryFn: () => fetchProgress(),
    refetchOnMount: false,
  });
  const friendsQ = useQuery({
    queryKey: ["social", "friendships"],
    queryFn: () => fetchFriends(),
  });
  const referralsQ = useQuery({
    queryKey: ["growth", "referrals"],
    queryFn: () => fetchReferrals(),
  });

  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarPath, setAvatarPath] = useState<string>("");
  const [avatarPreview, setAvatarPreview] = useState("");
  const [bannerImage, setBannerImage] = useState("");
  const [courtImage, setCourtImage] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [birthday, setBirthday] = useState("");
  const [playingHand, setPlayingHand] = useState<"right" | "left" | "ambi" | "">("");
  const [gender, setGender] = useState<"male" | "female" | "">("");
  const [favoriteRacket, setFavoriteRacket] = useState("");
  const [homeCourt, setHomeCourt] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [linking, setLinking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [defaults, setDefaults] = useState<MatchDefaults>({});
  const [dashboard, setDashboard] = useState<Dashboard>({});
  const [notifications, setNotifications] = useState<Notifications>({});
  const [publicProfileEnabled, setPublicProfileEnabled] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [activeEditSection, setActiveEditSection] = useState<EditSection>("profile");

  async function invalidateProfileData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: PREFERENCES_QUERY_KEY }),
      invalidateDashboard(queryClient),
    ]);
  }

  const identities = user?.identities ?? [];
  const hasGoogle = identities.some((i) => i.provider === "google");
  const hasEmail = identities.some((i) => i.provider === "email");

  async function onLinkGoogle() {
    setLinking(true);
    try {
      const { error } = await supabase.auth.linkIdentity({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/profile` },
      });
      if (error) throw error;
    } catch (err: any) {
      toast.error(err.message ?? "Could not link Google account");
      setLinking(false);
    }
  }

  async function onSendPasswordReset() {
    if (!user?.email) return;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success("Password reset email sent");
    } catch (err: any) {
      toast.error(err.message ?? "Could not send reset email");
    }
  }

  useEffect(() => {
    if (typeof window !== "undefined") {
      setBannerImage(window.localStorage.getItem(PROFILE_BANNER_KEY) ?? "");
      setCourtImage(window.localStorage.getItem(PROFILE_COURT_KEY) ?? "");
    }
    if (profile) {
      setHandle(profile.handle ?? "");
      setDisplayName(profile.display_name ?? "");
      setAvatarPath(profile.avatar_url ?? "");
      setBio((profile as any).bio ?? "");
      setLocation((profile as any).location ?? "");
      const savedBirthday =
        typeof window !== "undefined" ? window.localStorage.getItem(PROFILE_BIRTHDAY_KEY) : null;
      setBirthday((profile as any).birthday ?? savedBirthday ?? "");
      setPlayingHand(((profile as any).playing_hand ?? "") as any);
      const savedGender =
        typeof window !== "undefined" ? window.localStorage.getItem(PROFILE_GENDER_KEY) : null;
      setGender(((profile as any).gender ?? savedGender ?? "") as any);
      setFavoriteRacket((profile as any).favorite_racket ?? "");
      setHomeCourt((profile as any).home_court ?? "");
      resolveAvatar(profile.avatar_url ?? null).then(setAvatarPreview);
    }
  }, [profile]);

  useEffect(() => {
    if (prefs) {
      setDefaults((prefs.match_defaults as MatchDefaults) ?? {});
      setDashboard((prefs.dashboard as Dashboard) ?? {});
      setNotifications((prefs.notifications as Notifications) ?? {});
      setPublicProfileEnabled(Boolean((prefs as any).public_profile_enabled));
    }
  }, [prefs]);

  function onPickCustomizationImage(
    e: React.ChangeEvent<HTMLInputElement>,
    kind: "banner" | "court",
  ) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > 1.5 * 1024 * 1024) {
      toast.error("Use an image under 1.5 MB for fast loading");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const key = kind === "banner" ? PROFILE_BANNER_KEY : PROFILE_COURT_KEY;
      if (kind === "banner") setBannerImage(value);
      else setCourtImage(value);
      window.localStorage.setItem(key, value);
      toast.success(kind === "banner" ? "Player banner updated" : "Home-court photo updated");
    };
    reader.readAsDataURL(file);
  }
  function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please pick an image file");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Image must be under 20 MB");
      return;
    }
    setPendingFile(file);
  }

  async function onCroppedUpload(blob: Blob) {
    if (!user) return;
    setUploading(true);
    try {
      const path = `${user.id}/avatar-${Date.now()}.jpg`;
      const { error } = await supabase.storage
        .from("avatars")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (error) throw error;
      setAvatarPath(path);
      setAvatarPreview(await resolveAvatar(path));
      setPendingFile(null);
      toast.success("Photo uploaded — remember to save");
    } catch (err: any) {
      toast.error(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const profileData = {
      handle: handle.toLowerCase(),
      display_name: displayName,
      avatar_url: avatarPath || null,
      bio: bio || null,
      location: location || null,
      playing_hand: playingHand || null,
      gender: gender || null,
      favorite_racket: favoriteRacket || null,
      home_court: homeCourt || null,
      birthday: birthday || null,
    } as any;
    try {
      await saveProfile({ data: profileData });
      await savePrefs({
        data: {
          match_defaults: defaults,
          dashboard,
          notifications,
          public_profile_enabled: publicProfileEnabled,
        },
      });
      // Keep the selection available during the short window before the Supabase
      // schema migration reaches the remote schema cache.
      if (typeof window !== "undefined") {
        if (gender) window.localStorage.setItem(PROFILE_GENDER_KEY, gender);
        else window.localStorage.removeItem(PROFILE_GENDER_KEY);
        if (birthday) window.localStorage.setItem(PROFILE_BIRTHDAY_KEY, birthday);
        else window.localStorage.removeItem(PROFILE_BIRTHDAY_KEY);
      }
      toast.success("Profile saved");
      await invalidateProfileData();
      await refetch();
    } catch (err: any) {
      const message = String(err?.message ?? "").toLowerCase();
      const missingProfileField = ["gender", "birthday"].some(
        (field) =>
          message.includes(field) &&
          (message.includes("schema cache") || message.includes("column")),
      );
      if (!missingProfileField) {
        toast.error(err.message ?? "Save failed");
        return;
      }
      try {
        const { gender: _gender, birthday: _birthday, ...legacyProfileData } = profileData;
        void _gender;
        void _birthday;
        await saveProfile({ data: legacyProfileData });
        if (typeof window !== "undefined") {
          if (gender) window.localStorage.setItem(PROFILE_GENDER_KEY, gender);
          else window.localStorage.removeItem(PROFILE_GENDER_KEY);
          if (birthday) window.localStorage.setItem(PROFILE_BIRTHDAY_KEY, birthday);
          else window.localStorage.removeItem(PROFILE_BIRTHDAY_KEY);
        }
        toast.success("Profile saved");
        await invalidateProfileData();
        await refetch();
      } catch (legacyError: any) {
        toast.error(legacyError.message ?? "Save failed");
        return;
      }
    } finally {
      setSaving(false);
    }
  }

  async function onSavePrefs() {
    setSavingPrefs(true);
    try {
      await savePrefs({
        data: {
          match_defaults: defaults,
          dashboard,
          notifications,
          public_profile_enabled: publicProfileEnabled,
        },
      });
      toast.success("Preferences saved");
      await invalidateProfileData();
      await refetchPrefs();
    } catch (err: any) {
      toast.error(err.message ?? "Save failed");
    } finally {
      setSavingPrefs(false);
    }
  }
  async function onSignOut() {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  if (isLoading || prefsLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading profile…
      </div>
    );
  }
  if ((profileError && !profile) || (prefsError && !prefs)) {
    return (
      <section className="app-state" role="alert">
        <h1 className="app-page-title">Profile couldn't load</h1>
        <p>Your saved profile hasn't been changed.</p>
        <button
          className="button-secondary"
          onClick={() => {
            void refetch();
            void refetchPrefs();
          }}
        >
          Try again
        </button>
      </section>
    );
  }

  const shortcuts = new Set(dashboard.shortcuts ?? ["scoreboard", "ai", "history"]);
  const currentAge = calculateAge(birthday);
  const toggleShortcut = (id: NonNullable<Dashboard["shortcuts"]>[number]) => {
    const next = new Set(shortcuts);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDashboard({ ...dashboard, shortcuts: Array.from(next) as Dashboard["shortcuts"] });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {!editMode && (
        <ProfileProgressHome
          profile={profile}
          avatarPreview={avatarPreview}
          bannerImage={bannerImage}
          summary={progressQ.data}
          progressLoading={progressQ.isPending}
          progressError={progressQ.isError}
          retryProgress={() => void progressQ.refetch()}
          friends={(friendsQ.data ?? []).filter((friend: any) => friend.status === "accepted")}
          editHref="/profile/edit"
        />
      )}
      {editMode && (
        <>
          <p className="eyebrow text-primary">
            <Sliders className="h-3.5 w-3.5" /> Edit profile
          </p>
          <header className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary/20 text-primary">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="" className="h-16 w-16 rounded-full object-cover" />
                ) : (
                  <User className="h-7 w-7" />
                )}
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-background text-foreground shadow"
                  aria-label="Upload avatar"
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPickAvatar}
                />
              </div>
              <div>
                <h1 className="font-display text-2xl font-bold">Your profile</h1>
                <p className="text-sm text-muted-foreground">
                  Identity, match defaults, dashboard shortcuts, and nudges — all in one place.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.navigate({ to: "/profile" })}
              className="rounded-xl border border-white/10 bg-background/60 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:border-primary/30 hover:text-foreground"
            >
              Done editing
            </button>
          </header>

          <nav className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-card/50 p-2 sm:grid-cols-3 lg:grid-cols-6">
            {(
              [
                ["profile", "Profile", User],
                ["appearance", "Appearance", PaletteIcon],
                ["match", "Match setup", Sliders],
                ["dashboard", "Dashboard", LayoutDashboard],
                ["notifications", "Notifications", Bell],
                ["account", "Account", Link2],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveEditSection(key)}
                className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-semibold transition ${
                  activeEditSection === key
                    ? "bg-primary text-primary-foreground shadow"
                    : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </nav>

          {/* Identity */}
          {activeEditSection === "profile" && (
            <form
              onSubmit={onSave}
              className="rounded-2xl border border-white/10 bg-card/60 p-6 space-y-4 backdrop-blur"
            >
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-primary" />
                <h2 className="font-display text-lg font-semibold">Identity</h2>
              </div>
              <Field label="Handle" hint="lowercase letters, numbers, underscores">
                <div className="flex items-center rounded-lg border border-white/10 bg-background">
                  <span className="pl-3 text-sm text-muted-foreground">@</span>
                  <input
                    value={handle}
                    onChange={(e) => setHandle(e.target.value.toLowerCase())}
                    required
                    minLength={2}
                    maxLength={24}
                    pattern="[a-z0-9_]+"
                    className="w-full bg-transparent px-2 py-2 text-sm outline-none"
                  />
                </div>
              </Field>
              <Field label="Display name">
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  maxLength={60}
                  className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </Field>

              <Field label="Bio" hint={`${bio.length}/280`}>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value.slice(0, 280))}
                  rows={3}
                  placeholder="Attacking singles player, love a good drop shot…"
                  className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Location">
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    maxLength={80}
                    placeholder="Amsterdam"
                    className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </Field>
                <Field label="Home court">
                  <input
                    value={homeCourt}
                    onChange={(e) => setHomeCourt(e.target.value)}
                    maxLength={80}
                    placeholder="Sportcity Hall 3"
                    className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Birthday" hint="used to calculate age">
                  <input
                    type="date"
                    value={birthday}
                    max={todayDate()}
                    onChange={(e) => setBirthday(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </Field>
                <Field label="Age" hint="updates automatically">
                  <div className="flex min-h-[38px] items-center rounded-lg border border-white/10 bg-background px-3 py-2 text-sm">
                    {currentAge === null ? (
                      <span className="text-muted-foreground">Add your birthday</span>
                    ) : (
                      <span className="font-semibold text-foreground">{currentAge} years old</span>
                    )}
                  </div>
                </Field>
              </div>

              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold">Public profile card</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Let anyone with your profile link see your name, avatar, and headline
                      badminton stats. Private details and match notes are never included.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={publicProfileEnabled}
                    onClick={() => setPublicProfileEnabled((value) => !value)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${publicProfileEnabled ? "bg-primary" : "bg-white/15"}`}
                  >
                    <span
                      className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${publicProfileEnabled ? "left-6" : "left-1"}`}
                    />
                  </button>
                </div>
                {publicProfileEnabled && handle && (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-background/40 px-3 py-2 text-xs">
                    <span className="truncate text-muted-foreground">
                      {window.location.origin}/p/{handle}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        navigator.clipboard?.writeText(`${window.location.origin}/p/${handle}`)
                      }
                      className="inline-flex shrink-0 items-center gap-1 font-semibold text-primary"
                    >
                      <Link2 className="h-3.5 w-3.5" /> Copy link
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-white/10 bg-background/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">Invite your badminton circle</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Share your referral link. You both earn 100 XP when a new player saves their
                      first match.
                    </p>
                  </div>
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <input
                    readOnly
                    value={
                      referralsQ.data?.code
                        ? `${typeof window === "undefined" ? "" : window.location.origin}/auth?ref=${referralsQ.data.code}`
                        : "Loading…"
                    }
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-background px-3 py-2 text-xs text-muted-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const url = `${window.location.origin}/auth?ref=${referralsQ.data?.code ?? ""}`;
                      navigator.clipboard?.writeText(url);
                      toast.success("Referral link copied");
                    }}
                    className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                  >
                    Copy
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {
                    (referralsQ.data?.referrals ?? []).filter((r: any) => r.status === "completed")
                      .length
                  }{" "}
                  successful referral(s)
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Gender" hint="used for eligible junior divisions">
                  <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-background p-1">
                    {(["male", "female"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setGender(gender === value ? "" : value)}
                        className={`rounded-md px-2 py-1.5 text-xs font-semibold capitalize transition ${gender === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Playing hand">
                  <div className="grid grid-cols-3 gap-1 rounded-lg border border-white/10 bg-background p-1">
                    {(["right", "left", "ambi"] as const).map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => setPlayingHand(playingHand === h ? "" : h)}
                        className={`rounded-md px-2 py-1.5 text-xs font-semibold capitalize transition ${
                          playingHand === h
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {h === "ambi" ? "Both" : h}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Favorite racket">
                  <input
                    value={favoriteRacket}
                    onChange={(e) => setFavoriteRacket(e.target.value)}
                    maxLength={80}
                    placeholder="Yonex Astrox 99"
                    className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </Field>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={onSignOut}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                >
                  <LogOut className="h-3.5 w-3.5" /> Sign out
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save profile
                </button>
              </div>
            </form>
          )}

          {activeEditSection === "appearance" && (
            <section className="rounded-2xl border border-white/10 bg-card/60 p-6 space-y-4 backdrop-blur">
              <div className="flex items-center gap-2">
                <PaletteIcon />
                <div>
                  <h2 className="font-display text-lg font-semibold">Visual identity</h2>
                  <p className="text-xs text-muted-foreground">
                    Make the dashboard feel like your court. Images are saved privately on this
                    device.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label
                  className="group relative flex min-h-32 cursor-pointer items-end overflow-hidden rounded-2xl border border-white/10 bg-background p-4"
                  style={
                    bannerImage
                      ? {
                          backgroundImage: `linear-gradient(180deg, transparent 20%, rgba(2, 12, 22, .92)), url(${bannerImage})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }
                      : undefined
                  }
                >
                  {!bannerImage && (
                    <div>
                      <p className="text-sm font-semibold">Custom player banner</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Add a photo or personal visual.
                      </p>
                    </div>
                  )}
                  {bannerImage && (
                    <p className="relative text-xs font-semibold text-white">Player banner</p>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => onPickCustomizationImage(e, "banner")}
                  />
                </label>
                <label
                  className="group relative flex min-h-32 cursor-pointer items-end overflow-hidden rounded-2xl border border-white/10 bg-background p-4"
                  style={
                    courtImage
                      ? {
                          backgroundImage: `linear-gradient(180deg, transparent 20%, rgba(2, 12, 22, .92)), url(${courtImage})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }
                      : undefined
                  }
                >
                  {!courtImage && (
                    <div>
                      <p className="text-sm font-semibold">Home-court photo</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Show your favorite place to play.
                      </p>
                    </div>
                  )}
                  {courtImage && (
                    <p className="relative text-xs font-semibold text-white">Home court</p>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => onPickCustomizationImage(e, "court")}
                  />
                </label>
              </div>
            </section>
          )}
          {/* Match defaults */}
          {activeEditSection === "match" && (
            <section className="rounded-2xl border border-white/10 bg-card/60 p-6 space-y-4 backdrop-blur">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-primary" />
                <h2 className="font-display text-lg font-semibold">Match defaults</h2>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Preferred format">
                  <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-background p-1">
                    {(["singles", "doubles"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setDefaults({ ...defaults, mode: m })}
                        className={`rounded-md px-2 py-1.5 text-xs font-semibold capitalize transition ${
                          defaults.mode === m
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Best of">
                  <input
                    type="number"
                    min={1}
                    max={9}
                    value={defaults.best_of ?? 3}
                    onChange={(e) => setDefaults({ ...defaults, best_of: Number(e.target.value) })}
                    className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </Field>
                <Field label="Points to win">
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={defaults.points_to_win ?? 21}
                    onChange={(e) =>
                      setDefaults({ ...defaults, points_to_win: Number(e.target.value) })
                    }
                    className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </Field>
                <Field label="Scoring label" hint="e.g. 21-point">
                  <input
                    value={defaults.format ?? ""}
                    onChange={(e) => setDefaults({ ...defaults, format: e.target.value })}
                    placeholder="21-point"
                    className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </Field>
                <Field label="Your side name">
                  <input
                    value={defaults.starting_a ?? ""}
                    onChange={(e) => setDefaults({ ...defaults, starting_a: e.target.value })}
                    placeholder="You"
                    className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </Field>
                <Field label="Opponent side name">
                  <input
                    value={defaults.starting_b ?? ""}
                    onChange={(e) => setDefaults({ ...defaults, starting_b: e.target.value })}
                    placeholder="Opponent"
                    className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </Field>
                <Field label="Court color" hint="Landing overlay tint">
                  <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-background px-3 py-2">
                    <input
                      type="color"
                      value={defaults.court_color ?? "#1b4332"}
                      onChange={(e) => setDefaults({ ...defaults, court_color: e.target.value })}
                      className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">
                      {defaults.court_color ?? "#1b4332"}
                    </span>
                  </div>
                </Field>
              </div>
            </section>
          )}

          {/* Dashboard */}
          {activeEditSection === "dashboard" && (
            <section className="rounded-2xl border border-white/10 bg-card/60 p-6 space-y-4 backdrop-blur">
              <div className="flex items-center gap-2">
                <LayoutDashboard className="h-4 w-4 text-primary" />
                <h2 className="font-display text-lg font-semibold">Home dashboard</h2>
              </div>
              <p className="text-xs text-muted-foreground">
                Pin the shortcuts you use most — they appear at the top of your scoreboard.
              </p>
              <div className="flex flex-wrap gap-2">
                {ALL_SHORTCUTS.map((s) => {
                  const on = shortcuts.has(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleShortcut(s.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        on
                          ? "border-primary/50 bg-primary/15 text-primary"
                          : "border-white/10 bg-background text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {s.icon}
                      {s.label}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-3">
                <PrefToggle
                  label="Show quick stats"
                  checked={dashboard.show_stats ?? true}
                  onToggle={(v) => setDashboard({ ...dashboard, show_stats: v })}
                />
                <PrefToggle
                  label="Show head-to-head"
                  checked={dashboard.show_h2h ?? true}
                  onToggle={(v) => setDashboard({ ...dashboard, show_h2h: v })}
                />
                <PrefToggle
                  label="Show win streak"
                  checked={dashboard.show_streak ?? true}
                  onToggle={(v) => setDashboard({ ...dashboard, show_streak: v })}
                />
              </div>
              <div className="grid gap-3 pt-2 sm:grid-cols-2">
                <Field label="Dashboard layout" hint="Choose your information density">
                  <select
                    value={dashboard.layout ?? "balanced"}
                    onChange={(e) =>
                      setDashboard({ ...dashboard, layout: e.target.value as Dashboard["layout"] })
                    }
                    className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  >
                    <option value="compact">Compact</option>
                    <option value="balanced">Balanced</option>
                    <option value="stats-heavy">Stats heavy</option>
                  </select>
                </Field>
                <Field label="Coaching tone" hint="Used in your training notes">
                  <select
                    value={dashboard.coaching_tone ?? "friendly"}
                    onChange={(e) =>
                      setDashboard({
                        ...dashboard,
                        coaching_tone: e.target.value as Dashboard["coaching_tone"],
                      })
                    }
                    className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  >
                    <option value="friendly">Friendly</option>
                    <option value="competitive">Competitive</option>
                    <option value="technical">Technical</option>
                    <option value="blunt">Blunt</option>
                  </select>
                </Field>
              </div>
              <div className="grid gap-3 pt-2 sm:grid-cols-2 lg:grid-cols-4">
                {(["game", "set", "rally", "match"] as const).map((key) => (
                  <Field key={key} label={`${key[0].toUpperCase()}${key.slice(1)} label`}>
                    <input
                      value={dashboard.terminology?.[key] ?? ""}
                      onChange={(e) =>
                        setDashboard({
                          ...dashboard,
                          terminology: { ...dashboard.terminology, [key]: e.target.value },
                        })
                      }
                      placeholder={key[0].toUpperCase() + key.slice(1)}
                      maxLength={20}
                      className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </Field>
                ))}
              </div>
            </section>
          )}

          {/* Notifications */}
          {activeEditSection === "notifications" && (
            <section className="rounded-2xl border border-white/10 bg-card/60 p-6 space-y-4 backdrop-blur">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-primary" />
                <h2 className="font-display text-lg font-semibold">Notifications</h2>
              </div>
              <PushEnableRow />
              <p className="text-xs text-muted-foreground">
                Choose which nudges you want. Delivery starts once browser notifications are enabled
                above.
              </p>
              <div className="space-y-2">
                <PrefToggle
                  label="Match reminders"
                  description="Ping me before scheduled or usual playing times."
                  checked={notifications.match_reminders ?? false}
                  onToggle={(v) => setNotifications({ ...notifications, match_reminders: v })}
                />
                <PrefToggle
                  label="Weekly summary"
                  description="Every Monday: matches played, win rate, longest rally."
                  checked={notifications.weekly_summary ?? true}
                  onToggle={(v) => setNotifications({ ...notifications, weekly_summary: v })}
                />
                <PrefToggle
                  label="Win streak alerts"
                  description="Celebrate when you win 3+ in a row."
                  checked={notifications.win_streak_alerts ?? true}
                  onToggle={(v) => setNotifications({ ...notifications, win_streak_alerts: v })}
                />
                <Field label="Preferred reminder time">
                  <input
                    type="time"
                    value={notifications.reminder_time ?? "18:00"}
                    onChange={(e) =>
                      setNotifications({ ...notifications, reminder_time: e.target.value })
                    }
                    className="rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </Field>
              </div>
            </section>
          )}

          {(activeEditSection === "dashboard" || activeEditSection === "notifications") && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onSavePrefs}
                disabled={savingPrefs}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {savingPrefs ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save preferences
              </button>
            </div>
          )}

          {/* Linked accounts */}
          {activeEditSection === "account" && (
            <div className="rounded-2xl border border-white/10 bg-card/60 p-6 space-y-3 backdrop-blur">
              <div>
                <h2 className="font-display text-lg font-semibold">Linked accounts</h2>
                <p className="text-xs text-muted-foreground">
                  Connect a Google account to sign in faster next time.
                </p>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-white/10 bg-background/60 px-3 py-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold">
                    G
                  </span>
                  Google
                </div>
                {hasGoogle ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                    <Check className="h-3.5 w-3.5" /> Linked
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={onLinkGoogle}
                    disabled={linking}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {linking ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Link2 className="h-3.5 w-3.5" />
                    )}
                    Link Google
                  </button>
                )}
              </div>
              {hasEmail && user?.email && (
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-background/60 px-3 py-2.5">
                  <div className="text-sm">
                    <div className="font-medium">Email &amp; password</div>
                    <div className="text-xs text-muted-foreground">{user.email}</div>
                  </div>
                  <button
                    type="button"
                    onClick={onSendPasswordReset}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Send reset email
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {pendingFile && (
        <AvatarCropper
          file={pendingFile}
          onCancel={() => setPendingFile(null)}
          onConfirm={onCroppedUpload}
        />
      )}
    </div>
  );
}

function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function calculateAge(birthday: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return null;
  const [year, month, day] = birthday.split("-").map(Number);
  const birth = new Date(year, month - 1, day);
  if (
    Number.isNaN(birth.getTime()) ||
    birth.getFullYear() !== year ||
    birth.getMonth() !== month - 1 ||
    birth.getDate() !== day
  )
    return null;
  const now = new Date();
  let age = now.getFullYear() - year;
  const birthdayPassed =
    now.getMonth() > month - 1 || (now.getMonth() === month - 1 && now.getDate() >= day);
  if (!birthdayPassed) age -= 1;
  return age >= 0 && age <= 130 ? age : null;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {hint && <span className="text-[10px] text-muted-foreground/70">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function PrefToggle({
  label,
  description,
  checked,
  onToggle,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-background/60 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && <div className="text-[11px] text-muted-foreground">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onToggle(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
          checked ? "border-primary/50 bg-primary" : "border-white/10 bg-card/60"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

function PushEnableRow() {
  const { status, busy, enable, disable } = usePushSubscription();
  const sendTest = useServerFn(sendTestPush);

  const label =
    status === "subscribed"
      ? "Browser notifications on"
      : status === "denied"
        ? "Browser notifications blocked"
        : status === "unsupported"
          ? "Not supported in this browser"
          : "Enable browser notifications";

  const description =
    status === "subscribed"
      ? "You'll receive the alerts you've turned on below."
      : status === "denied"
        ? "Allow notifications in your browser's site settings, then reload."
        : status === "unsupported"
          ? "Try Chrome, Edge, or Safari on desktop or Android."
          : "Grant permission once so we can send reminders and streak alerts.";

  const canEnable = status !== "subscribed" && status !== "denied" && status !== "unsupported";
  const canDisable = status === "subscribed";

  async function onTest() {
    try {
      const res = await sendTest();
      if (res.sent > 0) toast.success("Test notification sent");
      else toast.error("No active device — enable notifications first");
    } catch (err: any) {
      toast.error(err.message ?? "Test failed");
    }
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-3">
      <div className="flex items-start gap-2 min-w-0">
        {status === "subscribed" ? (
          <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        ) : (
          <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{label}</div>
          <div className="text-[11px] text-muted-foreground">{description}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {canDisable && (
          <button
            type="button"
            onClick={onTest}
            className="rounded-md border border-white/10 bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Test
          </button>
        )}
        {canEnable && (
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Enable"}
          </button>
        )}
        {canDisable && (
          <button
            type="button"
            onClick={disable}
            disabled={busy}
            className="rounded-md border border-white/10 bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Turn off
          </button>
        )}
      </div>
    </div>
  );
}
