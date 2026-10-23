import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Accessibility,
  AlertTriangle,
  Bell,
  Check,
  Clock3,
  Contrast,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Mic,
  Moon,
  Palette,
  RotateCcw,
  Send,
  Shield,
  Smartphone,
  Sun,
  Trash2,
  UserRound,
  Vibrate,
  Volume2,
  Wind,
} from "lucide-react";
import {
  THEMES,
  ACCENT_PRESETS,
  type TextScale,
  type ThemeId,
  type ColorMode,
  getStoredTheme,
  getStoredPrefs,
  setTheme,
  setMode,
  setHighContrast,
  setReducedMotion,
  setAccent,
  setSound,
  setHaptics,
  setVoice,
  setTextScale,
  setColorBlindPalette,
  syncAccessibilityPrefs,
} from "@/lib/themes";
import { voiceSupported } from "@/lib/voice";
import { getMyPreferences, updateMyPreferences } from "@/lib/matches.functions";
import { getProgressSummary, updateProgressSettings } from "@/lib/progress.functions";
import {
  deleteMyAccount,
  exportMyAccountData,
  getMyPrivacy,
  updateMyPrivacy,
} from "@/lib/settings.functions";
import { sendTestPush } from "@/lib/push.functions";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";
import { invalidateDashboard, PREFERENCES_QUERY_KEY, PROGRESS_QUERY_KEY } from "@/lib/query-keys";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · ShuttleBoard" },
      {
        name: "description",
        content: "Customize accessibility, notifications, privacy, and account controls.",
      },
    ],
  }),
  component: SettingsPage,
});

type SettingsSection =
  | "accessibility"
  | "notifications"
  | "privacy"
  | "account"
  | "match"
  | "theme"
  | "accent"
  | "preview";

type AccessibilitySettings = {
  text_scale?: TextScale;
  color_blind_palette?: boolean;
  high_contrast?: boolean;
  reduced_motion?: boolean;
  sound?: boolean;
  haptics?: boolean;
  voice?: boolean;
};

type NotificationSettings = {
  match_reminders?: boolean;
  weekly_summary?: boolean;
  win_streak_alerts?: boolean;
  quest_reminders?: boolean;
  level_up_notifications?: boolean;
  achievement_notifications?: boolean;
  reminder_time?: string;
  schedule_enabled?: boolean;
  schedule_start?: string;
  schedule_end?: string;
  quiet_hours_enabled?: boolean;
  quiet_hours_start?: string;
  quiet_hours_end?: string;
  timezone?: string;
};

type PrivacySettings = {
  visibility: "friends" | "private";
  share_achievements: boolean;
  share_streaks: boolean;
  hide_personal_bests: boolean;
};

const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  match_reminders: false,
  weekly_summary: true,
  win_streak_alerts: true,
  quest_reminders: true,
  level_up_notifications: true,
  achievement_notifications: true,
  reminder_time: "18:00",
  schedule_enabled: false,
  schedule_start: "08:00",
  schedule_end: "21:00",
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
  timezone: "UTC",
};

const DEFAULT_PRIVACY: PrivacySettings = {
  visibility: "friends",
  share_achievements: true,
  share_streaks: true,
  hide_personal_bests: true,
};

function SettingsPage() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const fetchPreferences = useServerFn(getMyPreferences);
  const savePreferences = useServerFn(updateMyPreferences);
  const fetchPrivacy = useServerFn(getMyPrivacy);
  const savePrivacy = useServerFn(updateMyPrivacy);
  const exportAccount = useServerFn(exportMyAccountData);
  const deleteAccount = useServerFn(deleteMyAccount);
  const fetchProgress = useServerFn(getProgressSummary);
  const saveProgress = useServerFn(updateProgressSettings);
  const sendTestPushFn = useServerFn(sendTestPush);
  const push = usePushSubscription();

  const [active, setActive] = useState<ThemeId>("club");
  const [mode, setModeState] = useState<ColorMode>("dark");
  const [accent, setAccentState] = useState<string | null>(null);
  const [accessibility, setAccessibility] = useState<AccessibilitySettings>({});
  const [notifications, setNotifications] = useState<NotificationSettings>(DEFAULT_NOTIFICATIONS);
  const [privacy, setPrivacy] = useState<PrivacySettings>(DEFAULT_PRIVACY);
  const [celebrationEnabled, setCelebrationEnabled] = useState(true);
  const [activeSection, setActiveSection] = useState<SettingsSection>(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("reauth") === "delete"
      ? "account"
      : "accessibility",
  );
  const [installEvent, setInstallEvent] = useState<Event | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const preferencesQuery = useQuery({
    queryKey: ["settings", "preferences", user?.id],
    queryFn: () => fetchPreferences(),
    enabled: Boolean(user),
  });
  const privacyQuery = useQuery({
    queryKey: ["settings", "privacy", user?.id],
    queryFn: () => fetchPrivacy(),
    enabled: Boolean(user),
  });
  const progressQuery = useQuery({
    queryKey: ["progress", "summary"],
    queryFn: () => fetchProgress(),
    enabled: Boolean(user),
  });

  const preferenceMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => savePreferences({ data: data as any }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "preferences"] });
      queryClient.invalidateQueries({ queryKey: PREFERENCES_QUERY_KEY });
      invalidateDashboard(queryClient);
      toast.success("Settings saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const privacyMutation = useMutation({
    mutationFn: (data: PrivacySettings) => savePrivacy({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "privacy"] });
      toast.success("Privacy settings saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const progressMutation = useMutation({
    mutationFn: (data: { celebration_enabled: boolean }) => saveProgress({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROGRESS_QUERY_KEY });
      invalidateDashboard(queryClient);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  useEffect(() => {
    const stored = getStoredPrefs();
    setActive(getStoredTheme());
    setModeState(stored.mode);
    setAccentState(stored.accent);
    setAccessibility({
      text_scale: stored.textScale,
      color_blind_palette: stored.colorBlindPalette,
      high_contrast: stored.highContrast,
      reduced_motion: stored.reducedMotion,
      sound: stored.sound,
      haptics: stored.haptics,
      voice: stored.voice,
    });
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);

  useEffect(() => {
    const data = preferencesQuery.data as any;
    if (!data) return;
    const stored = getStoredPrefs();
    const nextAccessibility = {
      text_scale: stored.textScale,
      color_blind_palette: stored.colorBlindPalette,
      high_contrast: stored.highContrast,
      reduced_motion: stored.reducedMotion,
      sound: stored.sound,
      haptics: stored.haptics,
      voice: stored.voice,
      ...(data.accessibility ?? {}),
    };
    const nextNotifications = { ...DEFAULT_NOTIFICATIONS, ...(data.notifications ?? {}) };
    setAccessibility(nextAccessibility);
    setNotifications(nextNotifications);
    if (data.accessibility) {
      syncAccessibilityPrefs({
        textScale: nextAccessibility.text_scale,
        colorBlindPalette: nextAccessibility.color_blind_palette,
        highContrast: nextAccessibility.high_contrast,
        reducedMotion: nextAccessibility.reduced_motion,
        sound: nextAccessibility.sound,
        haptics: nextAccessibility.haptics,
        voice: nextAccessibility.voice,
      });
    }
  }, [preferencesQuery.data]);

  useEffect(() => {
    const data = privacyQuery.data;
    if (data) setPrivacy({ ...DEFAULT_PRIVACY, ...data });
  }, [privacyQuery.data]);

  useEffect(() => {
    const progress = progressQuery.data?.progress as any;
    if (progress) setCelebrationEnabled(progress.celebration_enabled ?? true);
  }, [progressQuery.data]);

  const updateAccessibility = (patch: AccessibilitySettings) => {
    const next = { ...accessibility, ...patch };
    setAccessibility(next);
    syncAccessibilityPrefs({
      textScale: next.text_scale,
      colorBlindPalette: next.color_blind_palette,
      highContrast: next.high_contrast,
      reducedMotion: next.reduced_motion,
      sound: next.sound,
      haptics: next.haptics,
      voice: next.voice,
    });
    if (user) preferenceMutation.mutate({ accessibility: next });
  };

  const updateNotification = (patch: NotificationSettings) => {
    const next = { ...notifications, ...patch };
    setNotifications(next);
    if (user) preferenceMutation.mutate({ notifications: next });
  };

  const pickTheme = (id: ThemeId) => {
    setTheme(id);
    setActive(id);
  };
  const pickMode = (next: ColorMode) => {
    setMode(next);
    setModeState(next);
  };
  const pickAccent = (color: string | null) => {
    setAccent(color);
    setAccentState(color);
  };

  async function updateEmail(event: FormEvent) {
    event.preventDefault();
    if (!newEmail || newEmail === user?.email)
      return toast.error("Enter a different email address");
    const { error } = await supabase.auth.updateUser({ email: newEmail });
    if (error) return toast.error(error.message);
    setNewEmail("");
    toast.success("Check your inbox to confirm the new email");
  }

  async function updatePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword.length < 6) return toast.error("Password must be at least 6 characters");
    if (newPassword !== confirmPassword) return toast.error("Passwords do not match");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return toast.error(error.message);
    setNewPassword("");
    setConfirmPassword("");
    toast.success("Password updated");
  }

  async function exportData() {
    try {
      const data = await exportAccount();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `shuttleboard-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Account export downloaded");
    } catch (error: any) {
      toast.error(error.message ?? "Could not export account data");
    }
  }

  async function removeAccount() {
    if (deleteConfirmation !== "DELETE MY ACCOUNT") {
      return toast.error("Type DELETE MY ACCOUNT to continue");
    }
    try {
      setDeleting(true);
      await deleteAccount({
        data: { confirmation: "DELETE MY ACCOUNT", password: deletePassword || undefined },
      });
      await supabase.auth.signOut();
      window.location.assign("/auth");
    } catch (error: any) {
      toast.error(error.message ?? "Could not delete account");
    } finally {
      setDeleting(false);
    }
  }

  async function sendTestNotification() {
    try {
      await sendTestPushFn();
      toast.success("Test push sent");
    } catch (error: any) {
      toast.error(error.message ?? "Test push failed");
    }
  }

  async function installApp() {
    if (!installEvent) return;
    const event = installEvent as Event & { prompt?: () => Promise<void> };
    await event.prompt?.();
    setInstallEvent(null);
  }

  const signedOut = !user;
  const darkThemes = THEMES.filter((theme) => theme.mode === "dark");
  const activeCategory =
    activeSection === "notifications"
      ? "notifications"
      : activeSection === "privacy"
        ? "privacy"
        : activeSection === "account"
          ? "account"
          : "experience";

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="eyebrow text-primary">
          <UserRound className="h-3.5 w-3.5" /> Settings
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
          Make ShuttleBoard work for you
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The essentials first, with advanced controls available when you need them.
          {signedOut
            ? " Sign in to sync settings across devices."
            : " Your account preferences sync across devices."}
        </p>
      </header>

      <nav className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-card/50 p-2 sm:grid-cols-4">
        {(
          [
            ["notifications", "Notifications", Bell, "notifications"],
            ["experience", "Experience", Accessibility, "accessibility"],
            ["privacy", "Privacy & social", Shield, "privacy"],
            ["account", "Account & data", Lock, "account"],
          ] as const
        ).map(([key, label, Icon, target]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveSection(target)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-semibold transition ${
              activeCategory === key
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </nav>

      {signedOut && activeCategory !== "experience" && (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
          You can preview local appearance controls without signing in. Sign in to save
          notification, privacy, and account settings.
        </div>
      )}

      {activeSection === "accessibility" && (
        <section className="space-y-4">
          <SectionHeader
            icon={<Accessibility className="h-4 w-4" />}
            title="Experience"
            detail="Appearance, accessibility, and match feel"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <Field label="Text size" hint="Choose a comfortable reading scale">
                <select
                  value={accessibility.text_scale ?? "normal"}
                  onChange={(event) => {
                    const value = event.target.value as TextScale;
                    setTextScale(value);
                    updateAccessibility({ text_scale: value });
                  }}
                  className="control"
                >
                  <option value="normal">Normal</option>
                  <option value="large">Large</option>
                  <option value="xlarge">Extra large</option>
                </select>
              </Field>
            </Card>
            <ToggleTile
              icon={<Contrast className="h-4 w-4 text-primary" />}
              title="High contrast"
              description="Stronger borders, brighter text, and clearer focus rings."
              checked={accessibility.high_contrast ?? false}
              onToggle={() => {
                const value = !(accessibility.high_contrast ?? false);
                setHighContrast(value);
                updateAccessibility({ high_contrast: value });
              }}
            />
            <ToggleTile
              icon={<Palette className="h-4 w-4 text-primary" />}
              title="Color-blind-friendly palette"
              description="Uses blue, orange, teal, and symbols for status instead of red/green alone."
              checked={accessibility.color_blind_palette ?? false}
              onToggle={() => {
                const value = !(accessibility.color_blind_palette ?? false);
                setColorBlindPalette(value);
                updateAccessibility({ color_blind_palette: value });
              }}
            />
            <ToggleTile
              icon={<Wind className="h-4 w-4 text-primary" />}
              title="Reduced motion"
              description="Minimize animations, transitions, and hover lifts."
              checked={accessibility.reduced_motion ?? false}
              onToggle={() => {
                const value = !(accessibility.reduced_motion ?? false);
                setReducedMotion(value);
                updateAccessibility({ reduced_motion: value });
              }}
            />
            <ToggleTile
              icon={<SparkleIcon />}
              title="Celebration animations"
              description="Show level-up, badge, and match-win celebrations."
              checked={celebrationEnabled}
              onToggle={() => {
                const value = !celebrationEnabled;
                setCelebrationEnabled(value);
                if (user) progressMutation.mutate({ celebration_enabled: value });
              }}
            />
          </div>
          <details className="group rounded-2xl border border-white/10 bg-card/30 p-1">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-xs font-semibold text-foreground transition hover:bg-background/40 [&::-webkit-details-marker]:hidden">
              <span>Advanced experience settings</span>
              <span className="text-muted-foreground transition group-open:rotate-180">Open</span>
            </summary>
            <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  ["match", "Match experience", Volume2],
                  ["theme", "Theme", Moon],
                  ["accent", "Accent color", Palette],
                  ["preview", "Visual preview", Check],
                ] as const
              ).map(([target, label, Icon]) => (
                <button
                  key={target}
                  type="button"
                  onClick={() => setActiveSection(target)}
                  className="button-secondary justify-start"
                >
                  <Icon className="h-3.5 w-3.5 text-primary" /> {label}
                </button>
              ))}
            </div>
          </details>
        </section>
      )}

      {activeSection === "notifications" && (
        <section className="space-y-4">
          <SectionHeader
            icon={<Bell className="h-4 w-4" />}
            title="Notifications"
            detail="Push delivery only"
          />
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <Smartphone className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <h3 className="font-display text-sm font-semibold">Browser notifications</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Enable push permission to receive quest, level-up, achievement, and reminder
                    alerts.
                  </p>
                  <p className="mt-2 text-xs text-primary">Status: {push.status}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {push.status === "subscribed" ? (
                  <button
                    type="button"
                    onClick={() => void push.disable()}
                    disabled={push.busy}
                    className="button-secondary"
                  >
                    Disable
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void push.enable()}
                    disabled={push.busy || push.status === "denied"}
                    className="button-primary"
                  >
                    {push.busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Enable
                  </button>
                )}
                {push.status === "subscribed" && (
                  <button
                    type="button"
                    onClick={() => void sendTestNotification()}
                    className="button-secondary"
                  >
                    <Send className="h-3.5 w-3.5" /> Test
                  </button>
                )}
              </div>
            </div>
          </Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <ToggleTile
              title="Quest reminders"
              description="Remind me about active Coach’s Corner quests."
              checked={notifications.quest_reminders ?? true}
              onToggle={() =>
                updateNotification({ quest_reminders: !(notifications.quest_reminders ?? true) })
              }
            />
            <ToggleTile
              title="Level-up notifications"
              description="Tell me when a new player level is unlocked."
              checked={notifications.level_up_notifications ?? true}
              onToggle={() =>
                updateNotification({
                  level_up_notifications: !(notifications.level_up_notifications ?? true),
                })
              }
            />
            <ToggleTile
              title="Achievement notifications"
              description="Celebrate newly earned badges."
              checked={notifications.achievement_notifications ?? true}
              onToggle={() =>
                updateNotification({
                  achievement_notifications: !(notifications.achievement_notifications ?? true),
                })
              }
            />
            <ToggleTile
              title="Match reminders"
              description="Ping me before scheduled or usual playing times."
              checked={notifications.match_reminders ?? false}
              onToggle={() =>
                updateNotification({ match_reminders: !(notifications.match_reminders ?? false) })
              }
            />
            <ToggleTile
              title="Weekly progress summary"
              description="Every Monday: matches, win rate, and longest rally."
              checked={notifications.weekly_summary ?? true}
              onToggle={() =>
                updateNotification({ weekly_summary: !(notifications.weekly_summary ?? true) })
              }
            />
            <ToggleTile
              title="Win streak alerts"
              description="Celebrate when you win three or more in a row."
              checked={notifications.win_streak_alerts ?? true}
              onToggle={() =>
                updateNotification({
                  win_streak_alerts: !(notifications.win_streak_alerts ?? true),
                })
              }
            />
          </div>
          <details className="rounded-2xl border border-white/10 bg-card/30 p-1">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-background/40 [&::-webkit-details-marker]:hidden">
              <Clock3 className="h-4 w-4 text-primary" />
              <span>Schedule and quiet hours</span>
            </summary>
            <div className="p-4 pt-2">
              <p className="text-xs text-muted-foreground">
                Alerts are queued during quiet hours and delivered when the allowed window opens.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <ToggleTile
                  title="Use schedule"
                  description="Limit all pushes to a daily window."
                  checked={notifications.schedule_enabled ?? false}
                  onToggle={() =>
                    updateNotification({
                      schedule_enabled: !(notifications.schedule_enabled ?? false),
                    })
                  }
                  compact
                />
                <Field label="Allowed from">
                  <input
                    type="time"
                    value={notifications.schedule_start ?? "08:00"}
                    onChange={(event) => updateNotification({ schedule_start: event.target.value })}
                    className="control"
                  />
                </Field>
                <Field label="Allowed until">
                  <input
                    type="time"
                    value={notifications.schedule_end ?? "21:00"}
                    onChange={(event) => updateNotification({ schedule_end: event.target.value })}
                    className="control"
                  />
                </Field>
                <Field label="Timezone">
                  <input
                    value={notifications.timezone ?? "UTC"}
                    onChange={(event) => updateNotification({ timezone: event.target.value })}
                    className="control"
                    placeholder="Europe/Amsterdam"
                  />
                </Field>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <ToggleTile
                  title="Quiet hours"
                  description="Hold pushes overnight."
                  checked={notifications.quiet_hours_enabled ?? false}
                  onToggle={() =>
                    updateNotification({
                      quiet_hours_enabled: !(notifications.quiet_hours_enabled ?? false),
                    })
                  }
                  compact
                />
                <Field label="Quiet hours start">
                  <input
                    type="time"
                    value={notifications.quiet_hours_start ?? "22:00"}
                    onChange={(event) =>
                      updateNotification({ quiet_hours_start: event.target.value })
                    }
                    className="control"
                  />
                </Field>
                <Field label="Quiet hours end">
                  <input
                    type="time"
                    value={notifications.quiet_hours_end ?? "07:00"}
                    onChange={(event) =>
                      updateNotification({ quiet_hours_end: event.target.value })
                    }
                    className="control"
                  />
                </Field>
              </div>
            </div>
          </details>
        </section>
      )}

      {activeSection === "privacy" && (
        <section className="space-y-4">
          <SectionHeader
            icon={<Shield className="h-4 w-4" />}
            title="Privacy & social"
            detail="Friends-only by default"
          />
          <Card>
            <Field
              label="Profile visibility"
              hint="Basic identity can remain searchable so friends can find you."
            >
              <select
                value={privacy.visibility}
                onChange={(event) => {
                  const next = {
                    ...privacy,
                    visibility: event.target.value as PrivacySettings["visibility"],
                  };
                  setPrivacy(next);
                  if (user) privacyMutation.mutate(next);
                }}
                className="control"
              >
                <option value="friends">Friends only</option>
                <option value="private">Private</option>
              </select>
            </Field>
          </Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <ToggleTile
              icon={<Eye className="h-4 w-4 text-primary" />}
              title="Share achievements with friends"
              description="Accepted friends can see badges you have earned."
              checked={privacy.share_achievements}
              onToggle={() => {
                const next = { ...privacy, share_achievements: !privacy.share_achievements };
                setPrivacy(next);
                if (user) privacyMutation.mutate(next);
              }}
            />
            <ToggleTile
              icon={<Eye className="h-4 w-4 text-primary" />}
              title="Share streaks with friends"
              description="Accepted friends can see your current streak."
              checked={privacy.share_streaks}
              onToggle={() => {
                const next = { ...privacy, share_streaks: !privacy.share_streaks };
                setPrivacy(next);
                if (user) privacyMutation.mutate(next);
              }}
            />
            <ToggleTile
              icon={<EyeOff className="h-4 w-4 text-primary" />}
              title="Hide personal-best details"
              description="Keep record values and source matches private."
              checked={privacy.hide_personal_bests}
              onToggle={() => {
                const next = { ...privacy, hide_personal_bests: !privacy.hide_personal_bests };
                setPrivacy(next);
                if (user) privacyMutation.mutate(next);
              }}
            />
          </div>
          <Card>
            <p className="text-xs text-muted-foreground">
              Private strategy memories, reflections, match notes, and opponent records are never
              shared through these settings.
            </p>
          </Card>
        </section>
      )}

      {activeSection === "account" && (
        <section className="space-y-4">
          <SectionHeader
            icon={<Lock className="h-4 w-4" />}
            title="Account & data"
            detail="Sensitive actions"
          />
          {!user ? (
            <Card>
              <p className="text-sm text-muted-foreground">
                Sign in to manage your email, password, export, or account deletion.
              </p>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-primary" />
                    <h3 className="font-display text-sm font-semibold">Change email</h3>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Current email: {user.email ?? "Unavailable"}. A confirmation link will be sent.
                  </p>
                  <form onSubmit={updateEmail} className="mt-4 flex gap-2">
                    <input
                      type="email"
                      required
                      value={newEmail}
                      onChange={(event) => setNewEmail(event.target.value)}
                      placeholder="new@email.com"
                      className="control"
                    />
                    <button className="button-primary" type="submit">
                      Update
                    </button>
                  </form>
                </Card>
                <Card>
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-primary" />
                    <h3 className="font-display text-sm font-semibold">Change password</h3>
                  </div>
                  <form onSubmit={updatePassword} className="mt-4 space-y-2">
                    <input
                      type="password"
                      minLength={6}
                      required
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      placeholder="New password"
                      className="control"
                    />
                    <input
                      type="password"
                      minLength={6}
                      required
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Confirm password"
                      className="control"
                    />
                    <button className="button-primary" type="submit">
                      Update password
                    </button>
                  </form>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!user.email) return;
                      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
                        redirectTo: `${window.location.origin}/reset-password`,
                      });
                      if (error) toast.error(error.message);
                      else toast.success("Password reset email sent");
                    }}
                    className="mt-3 text-xs text-primary hover:underline"
                  >
                    Send reset email instead
                  </button>
                </Card>
              </div>
              <Card>
                <div className="flex items-center gap-2">
                  <Download className="h-4 w-4 text-primary" />
                  <h3 className="font-display text-sm font-semibold">Export account data</h3>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Download a complete JSON backup of your profile, matches, reflections, progress,
                  preferences, privacy settings, and social records. Credentials and push secrets
                  are excluded.
                </p>
                <button
                  type="button"
                  onClick={() => void exportData()}
                  className="button-secondary mt-4"
                >
                  <Download className="h-3.5 w-3.5" /> Download JSON
                </button>
              </Card>
              <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5">
                <div className="flex items-center gap-2">
                  <Trash2 className="h-4 w-4 text-destructive" />
                  <h3 className="font-display text-sm font-semibold">Delete account</h3>
                  {user?.identities?.some((i) => i.provider === "google") && (
                    <button
                      type="button"
                      className="mt-2 text-sm text-primary underline"
                      onClick={() =>
                        void supabase.auth
                          .signInWithOAuth({
                            provider: "google",
                            options: {
                              redirectTo: window.location.origin + "/settings?reauth=delete",
                              queryParams: { prompt: "select_account" },
                            },
                          })
                          .then(({ error }) => {
                            if (error) toast.error(error.message);
                          })
                      }
                    >
                      Reauthenticate with Google
                    </button>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Enter your current password or reauthenticate with Google, then confirm deletion
                    within five minutes. Reauthentication does not delete anything.
                  </p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  This permanently removes your account and owned data. Export anything you need
                  first.
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <input
                    type="password"
                    value={deletePassword}
                    onChange={(event) => setDeletePassword(event.target.value)}
                    placeholder="Current password (email accounts)"
                    className="control"
                  />
                  <input
                    value={deleteConfirmation}
                    onChange={(event) => setDeleteConfirmation(event.target.value)}
                    placeholder="Type DELETE MY ACCOUNT"
                    className="control"
                  />
                </div>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void removeAccount()}
                  className="mt-3 inline-flex items-center gap-2 rounded-full bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground"
                >
                  <AlertTriangle className="h-3.5 w-3.5" /> Permanently delete account
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {activeSection === "match" && (
        <section className="space-y-4">
          <SectionHeader
            icon={<Volume2 className="h-4 w-4" />}
            title="Match experience"
            detail="Feedback & hands-free"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <ToggleTile
              icon={<Volume2 className="h-4 w-4 text-primary" />}
              title="Point sounds"
              description="Subtle chimes for points, game ball, and match win."
              checked={accessibility.sound ?? true}
              onToggle={() => {
                const value = !(accessibility.sound ?? true);
                setSound(value);
                updateAccessibility({ sound: value });
              }}
            />
            <ToggleTile
              icon={<Vibrate className="h-4 w-4 text-primary" />}
              title="Haptic feedback"
              description="Short vibration on point events where supported."
              checked={accessibility.haptics ?? true}
              onToggle={() => {
                const value = !(accessibility.haptics ?? true);
                setHaptics(value);
                updateAccessibility({ haptics: value });
              }}
            />
            <ToggleTile
              icon={<Mic className="h-4 w-4 text-primary" />}
              title="Voice commands"
              description={
                voiceSupported()
                  ? "Say point A, fault B, or undo on the scoreboard."
                  : "Not supported in this browser."
              }
              checked={(accessibility.voice ?? false) && voiceSupported()}
              onToggle={() => {
                const value = !(accessibility.voice ?? false);
                setVoice(value);
                updateAccessibility({ voice: value });
              }}
            />
            <Card>
              <div className="flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-primary" />
                <h3 className="font-display text-sm font-semibold">Install as app</h3>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {installEvent
                  ? "Install ShuttleBoard to your home screen."
                  : "Use your browser’s Add to Home Screen menu."}
              </p>
              <button
                type="button"
                onClick={() => void installApp()}
                disabled={!installEvent}
                className="button-secondary mt-4 disabled:opacity-40"
              >
                Install
              </button>
            </Card>
          </div>
        </section>
      )}

      {activeSection === "theme" && (
        <section className="space-y-4">
          <SectionHeader
            icon={<Moon className="h-4 w-4" />}
            title="Theme"
            detail={mode === "light" ? "Light mode active" : `${darkThemes.length} dark presets`}
          />
          <Card>
            <div className="flex items-center gap-2">
              <Sun className="h-4 w-4 text-primary" />
              <h3 className="font-display text-sm font-semibold">Color mode</h3>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <ModeButton
                active={mode === "light"}
                onClick={() => pickMode("light")}
                icon={<Sun className="h-4 w-4" />}
                label="Light"
              />
              <ModeButton
                active={mode === "dark"}
                onClick={() => pickMode("dark")}
                icon={<Moon className="h-4 w-4" />}
                label="Dark"
              />
            </div>
          </Card>
          <div className={`grid gap-4 sm:grid-cols-2 ${mode === "light" ? "opacity-60" : ""}`}>
            {darkThemes.map((theme) => (
              <button
                key={theme.id}
                type="button"
                onClick={() => pickTheme(theme.id)}
                aria-pressed={active === theme.id}
                className={`bento-tile text-left transition hover:-translate-y-0.5 ${active === theme.id ? "tile-glow" : ""}`}
              >
                <div
                  className="flex h-24 items-end gap-1 p-3"
                  style={{
                    background: `linear-gradient(135deg, ${theme.swatches[0]}, ${theme.swatches[1]})`,
                  }}
                >
                  {theme.swatches.map((color) => (
                    <span
                      key={color}
                      className="h-8 flex-1 rounded-md ring-1 ring-white/10"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="flex items-center justify-between p-4">
                  <div>
                    <div className="font-display text-sm font-semibold">{theme.name}</div>
                    <div className="text-xs text-muted-foreground">{theme.tagline}</div>
                  </div>
                  {active === theme.id && <Check className="h-4 w-4 text-primary" />}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {activeSection === "accent" && (
        <section className="space-y-4">
          <SectionHeader
            icon={<Palette className="h-4 w-4" />}
            title="Accent color"
            detail="Updates instantly"
          />
          <Card>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-sm font-semibold">Choose your court accent</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Used for buttons, active states, court lines, and highlights.
                </p>
              </div>
              <button type="button" onClick={() => pickAccent(null)} className="button-secondary">
                <RotateCcw className="h-3.5 w-3.5" /> Theme default
              </button>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              {ACCENT_PRESETS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => pickAccent(color)}
                  aria-label={`Use accent ${color}`}
                  aria-pressed={accent?.toLowerCase() === color.toLowerCase()}
                  className={`h-9 w-9 rounded-full ring-2 transition ${accent?.toLowerCase() === color.toLowerCase() ? "scale-110 ring-foreground" : "ring-white/10 hover:ring-white/30"}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <label
              htmlFor="accent-color"
              className="mt-5 flex w-fit items-center gap-3 rounded-xl border border-white/10 bg-card/60 px-3 py-2"
            >
              <input
                id="accent-color"
                type="color"
                value={accent ?? "#2dd4a8"}
                onChange={(event) => pickAccent(event.target.value)}
                className="h-9 w-9 cursor-pointer rounded-md border-0 bg-transparent p-0"
              />
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                {accent ?? "theme default"}
              </span>
            </label>
          </Card>
        </section>
      )}

      {activeSection === "preview" && (
        <section className="space-y-4">
          <SectionHeader
            icon={<Check className="h-4 w-4" />}
            title="Live preview"
            detail="Theme tokens"
          />
          <Card>
            <p className="text-xs text-muted-foreground">
              Preview the current visual system and accessible status colors.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <PreviewSwatch label="Background" varName="--background" />
              <PreviewSwatch label="Primary" varName="--primary" />
              <PreviewSwatch label="IN / success" varName="--in" />
              <PreviewSwatch label="OUT / caution" varName="--out" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="button-primary" type="button">
                Primary action
              </button>
              <span className="rounded-full bg-[var(--in)] px-3 py-2 text-xs font-semibold text-[var(--in-foreground)]">
                IN
              </span>
              <span className="rounded-full bg-[var(--out)] px-3 py-2 text-xs font-semibold text-[var(--out-foreground)]">
                OUT
              </span>
            </div>
          </Card>
        </section>
      )}
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        {icon}
        {title}
      </h2>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="bento-tile p-5">{children}</div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between text-xs font-semibold text-muted-foreground">
        <span>{label}</span>
        {hint && <span className="text-[10px] font-normal">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function ToggleTile({
  icon,
  title,
  description,
  checked,
  onToggle,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`bento-tile flex items-start justify-between gap-4 ${compact ? "p-3" : "p-5"}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon}
          {<h3 className="font-display text-sm font-semibold">{title}</h3>}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={onToggle}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${checked ? "border-primary/50 bg-primary" : "border-white/10 bg-card/60"}`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`}
        />
      </button>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${active ? "border-primary/60 bg-primary text-primary-foreground shadow-[var(--shadow-glow)]" : "border-white/10 bg-card/60 text-foreground hover:border-white/20"}`}
    >
      {icon}
      {label}
    </button>
  );
}

function PreviewSwatch({ label, varName }: { label: string; varName: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-card/60 p-3">
      <div
        className="h-10 w-full rounded-lg ring-1 ring-white/10"
        style={{ backgroundColor: `var(${varName})` }}
      />
      <div className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function SparkleIcon() {
  return (
    <span aria-hidden="true" className="text-primary">
      ✦
    </span>
  );
}
