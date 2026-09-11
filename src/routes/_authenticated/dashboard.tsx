import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Flame,
  Gauge,
  Goal,
  History,
  Play,
  Plus,
  Sparkles,
  Swords,
  Trophy,
  Users,
  WandSparkles,
} from "lucide-react";
import { getMyPreferences, listMyMatches, updateMyPreferences } from "@/lib/matches.functions";
import { getProgressSummary } from "@/lib/progress.functions";
import { getDashboardCore, type DashboardCoreData } from "@/lib/dashboard.functions";
import {
  DASHBOARD_CORE_QUERY_KEY,
  MATCHES_QUERY_KEY,
  PREFERENCES_QUERY_KEY,
  PROGRESS_QUERY_KEY,
} from "@/lib/query-keys";

export const Route = createFileRoute("/_authenticated/dashboard")({
  ssr: false,
  head: () => ({ meta: [{ title: "Dashboard · ShuttleBoard" }] }),
  component: DashboardPage,
});

type Match = {
  id: string;
  mode: "singles" | "doubles";
  format?: string;
  winner: "A" | "B" | null;
  team_a_names: string[];
  team_b_names: string[];
  team_a_user_ids?: string[];
  team_b_user_ids?: string[];
  games: Array<{ a: number; b: number }>;
  started_at: string;
  finished_at?: string | null;
  duration_seconds?: number;
  tags?: string[];
};

type GoalState = { title: string; target: number; progress: number; unit: string };
type DashboardPrefs = {
  layout?: "compact" | "balanced" | "stats-heavy";
  coaching_tone?: "friendly" | "competitive" | "technical" | "blunt";
  terminology?: { game?: string; set?: string; rally?: string; match?: string };
};

const DEFAULT_GOAL: GoalState = {
  title: "Play twice this week",
  target: 2,
  progress: 0,
  unit: "matches",
};

function DashboardPage() {
  const queryClient = useQueryClient();
  const fetchCore = useServerFn(getDashboardCore);
  const fetchMatches = useServerFn(listMyMatches);
  const fetchPrefs = useServerFn(getMyPreferences);
  const fetchProgress = useServerFn(getProgressSummary);
  const savePrefs = useServerFn(updateMyPreferences);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const coreQ = useQuery<DashboardCoreData>({
    queryKey: DASHBOARD_CORE_QUERY_KEY,
    queryFn: () => fetchCore(),
    staleTime: 60_000,
    gcTime: 300_000,
    refetchOnMount: false,
  });
  const matchesQ = useQuery({
    queryKey: MATCHES_QUERY_KEY,
    queryFn: () => fetchMatches(),
    enabled: detailsOpen,
    staleTime: 60_000,
    gcTime: 300_000,
    refetchOnMount: false,
  });
  const prefsQ = useQuery({
    queryKey: PREFERENCES_QUERY_KEY,
    queryFn: () => fetchPrefs(),
    enabled: detailsOpen,
    staleTime: 60_000,
    gcTime: 300_000,
    refetchOnMount: false,
  });
  const progressQ = useQuery({
    queryKey: PROGRESS_QUERY_KEY,
    queryFn: () => fetchProgress(),
    enabled: detailsOpen,
    staleTime: 60_000,
    gcTime: 300_000,
    refetchOnMount: false,
  });
  const [goal, setGoal] = useState<GoalState>(DEFAULT_GOAL);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState(DEFAULT_GOAL);

  useEffect(() => {
    const stored = (prefsQ.data?.dashboard as unknown as { goal?: GoalState } | undefined)?.goal;
    if (stored?.title) {
      setGoal({ ...DEFAULT_GOAL, ...stored });
      setGoalDraft({ ...DEFAULT_GOAL, ...stored });
    }
  }, [prefsQ.data]);

  const rawMatches = matchesQ.data;
  const matches = useMemo(() => (rawMatches ?? []) as unknown as Match[], [rawMatches]);
  const profile = coreQ.data?.profile;
  const dashboardPrefs = ((prefsQ.data?.dashboard as unknown as DashboardPrefs | undefined) ??
    coreQ.data?.dashboard ??
    {}) as DashboardPrefs;
  const layout = dashboardPrefs.layout ?? "balanced";
  const coachingTone = dashboardPrefs.coaching_tone ?? "friendly";
  const terminology = {
    game: "Game",
    set: "Set",
    rally: "Rally",
    match: "Match",
    ...dashboardPrefs.terminology,
  };
  const bannerImage =
    typeof window !== "undefined"
      ? window.localStorage.getItem("shuttleboard.profile-banner.v1")
      : null;
  const courtImage =
    typeof window !== "undefined"
      ? window.localStorage.getItem("shuttleboard.profile-court-photo.v1")
      : null;
  const name = profile?.display_name || profile?.handle || "player";
  const firstName = name.split(" ")[0];
  const stats = useMemo(() => getStats(matches), [matches]);
  const weekMatches = useMemo(() => matches.filter((m) => isThisWeek(m.started_at)), [matches]);
  const recent = matches.slice(0, 5);
  const lastMatch = matches[0] ?? (coreQ.data?.latestMatch as Match | null) ?? undefined;
  const usual = getUsualMatch(matches, profile);
  const greeting = getGreeting();
  const goalProgress = goal.title.toLowerCase().includes("win") ? stats.wins : weekMatches.length;
  const progress = Math.min(goal.target, Math.max(goal.progress, goalProgress));
  const activeQuest = progressQ.data?.activeQuest ?? coreQ.data?.activeQuest;
  const hasMatches = coreQ.data?.hasMatches ?? matches.length > 0;
  const questTarget = activeQuest?.target_value ?? (hasMatches ? goal.target : 1);
  const questCurrent = activeQuest?.progress ?? (hasMatches ? progress : 0);
  const questPercent = Math.min(100, Math.max(0, (questCurrent / Math.max(1, questTarget)) * 100));

  if (coreQ.isPending) return <DashboardSkeleton />;
  if (coreQ.isError) {
    return <DashboardError onRetry={() => void coreQ.refetch()} />;
  }

  async function saveGoal() {
    const next = { ...goalDraft, target: Math.max(1, Number(goalDraft.target) || 1), progress: 0 };
    setGoal(next);
    setEditingGoal(false);
    await savePrefs({
      data: {
        ...(prefsQ.data as any),
        dashboard: { ...(prefsQ.data?.dashboard ?? {}), goal: next },
      } as any,
    });
    await queryClient.invalidateQueries({ queryKey: DASHBOARD_CORE_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: PREFERENCES_QUERY_KEY });
  }

  return (
    <div className={layout === "compact" ? "space-y-4" : "space-y-6"}>
      <header
        className="relative overflow-hidden rounded-3xl border border-primary/20 bg-card/70 p-6 shadow-[0_20px_80px_oklch(0.16_0.04_190/0.3)] backdrop-blur-xl sm:p-8"
        style={
          bannerImage
            ? {
                backgroundImage: `linear-gradient(120deg, rgba(3, 15, 25, .96), rgba(3, 15, 25, .62)), url(${bannerImage})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Player dashboard
            </div>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-5xl">
              {greeting}, {firstName}.
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Your court, your rhythm, your next {terminology.rally.toLowerCase()}. Everything you
              need before the next {terminology.match.toLowerCase()} is here.
            </p>
          </div>
          <Link
            to="/match-lobby"
            className="btn-primary-glow inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold"
          >
            <Play className="h-4 w-4 fill-current" /> Start a match
          </Link>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="bento-tile p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">
                <Goal className="h-3.5 w-3.5" /> Coach&apos;s Corner
              </p>
              <h2 className="mt-2 font-display text-xl font-semibold">
                {activeQuest?.title ?? (hasMatches ? goal.title : "Play your first match")}
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {activeQuest
                  ? `${activeQuest.progress ?? 0} / ${activeQuest.target_value ?? 1} complete`
                  : hasMatches
                    ? "A small target keeps your next session focused."
                    : "Start with one completed match to build your player profile."}
              </p>
            </div>
            <span className="rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
              Next step
            </span>
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-background">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${questPercent}%` }}
            />
          </div>
          <Link
            to={hasMatches ? "/progress" : "/match-lobby"}
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          >
            {hasMatches ? "Open progress" : "Start your first match"}
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </section>

        <section className="bento-tile p-5 sm:p-6">
          <p className="eyebrow">
            <History className="h-3.5 w-3.5" /> Latest match
          </p>
          {lastMatch ? (
            <>
              <h2 className="mt-2 font-display text-xl font-semibold">
                {lastMatch.team_a_names.join(" & ")} vs {lastMatch.team_b_names.join(" & ")}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDate(lastMatch.started_at)} ·{" "}
                {lastMatch.mode === "singles" ? "Singles" : "Doubles"}
              </p>
              <div className="mt-5 flex items-end justify-between gap-3">
                <div>
                  <p className="text-2xl font-bold text-primary">
                    {lastMatch.winner ? (lastMatch.winner === "A" ? "Win" : "Loss") : "In progress"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {lastMatch.games.length} games recorded
                  </p>
                </div>
                <Link to="/history" className="text-xs font-semibold text-primary hover:underline">
                  Review <ChevronRight className="inline h-3.5 w-3.5" />
                </Link>
              </div>
            </>
          ) : (
            <>
              <h2 className="mt-2 font-display text-xl font-semibold">Your story starts here</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Save your first result to unlock useful patterns and personal progress.
              </p>
              <Link
                to="/match-lobby"
                className="btn-primary-glow mt-5 inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-semibold"
              >
                <Play className="h-3.5 w-3.5 fill-current" /> Start a match
              </Link>
            </>
          )}
        </section>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <CompactStat label="Level" value={coreQ.data.progress.level_name} />
        <CompactStat label="XP" value={`${coreQ.data.progress.total_xp}`} />
        <CompactStat label="Win streak" value={`${coreQ.data.progress.current_streak}`} />
      </div>

      <section className="bento-tile p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">
              <Sparkles className="h-3.5 w-3.5" /> One useful insight
            </p>
            <h2 className="mt-2 font-display text-xl font-semibold">
              {coreQ.data.insight?.label ?? "Your first pattern is forming"}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              {coreQ.data.insight?.description ??
                "Save a match to unlock personalized insights based on your real results."}
            </p>
          </div>
          <Link
            to="/progress"
            className="shrink-0 text-xs font-semibold text-primary hover:underline"
          >
            View progress <ChevronRight className="inline h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      <details
        className="group rounded-2xl border border-white/10 bg-card/30 p-1"
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-background/40 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" /> More progress and shortcuts
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-6 p-3 pt-4 sm:p-4">
          <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
            <section className="bento-tile p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">
                    <Goal className="h-3.5 w-3.5" /> Your next goal
                  </p>
                  <h2 className="mt-2 font-display text-xl font-semibold">{goal.title}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Small, consistent sessions build serious court time.
                  </p>
                </div>
                <button
                  onClick={() => setEditingGoal((v) => !v)}
                  className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                >
                  Edit goal
                </button>
              </div>
              {editingGoal ? (
                <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_100px_auto]">
                  <input
                    value={goalDraft.title}
                    onChange={(e) => setGoalDraft({ ...goalDraft, title: e.target.value })}
                    className="rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                    maxLength={60}
                  />
                  <input
                    type="number"
                    min={1}
                    value={goalDraft.target}
                    onChange={(e) => setGoalDraft({ ...goalDraft, target: Number(e.target.value) })}
                    className="rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                  <button
                    onClick={saveGoal}
                    className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                  >
                    <Check className="mr-1 inline h-3.5 w-3.5" />
                    Save
                  </button>
                </div>
              ) : (
                <div className="mt-5">
                  <div className="flex items-end justify-between text-xs">
                    <span className="text-muted-foreground">
                      {progress} of {goal.target} {goal.unit}
                    </span>
                    <strong className="text-primary">
                      {Math.round((progress / goal.target) * 100)}%
                    </strong>
                  </div>
                  <div className="mt-2 h-3 overflow-hidden rounded-full bg-background">
                    <div
                      className="h-full rounded-full shadow-[var(--shadow-glow)] transition-all duration-700"
                      style={{
                        width: `${Math.min(100, (progress / goal.target) * 100)}%`,
                        background: "var(--gradient-primary)",
                      }}
                    />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1">
                      <CalendarDays className="mr-1 inline h-3 w-3 text-primary" />
                      {weekMatches.length} this week
                    </span>
                    <span className="rounded-full border border-white/10 px-2.5 py-1">
                      <Flame className="mr-1 inline h-3 w-3 text-primary" />
                      {stats.streak}-match streak
                    </span>
                  </div>
                </div>
              )}
            </section>
            <section className="bento-tile p-5 sm:p-6">
              <p className="eyebrow">
                <WandSparkles className="h-3.5 w-3.5" /> Usual match
              </p>
              <h2 className="mt-2 font-display text-xl font-semibold">{usual.title}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{usual.subtitle}</p>
              <Link
                to="/match-lobby"
                className="mt-5 inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3.5 py-2.5 text-xs font-semibold text-primary transition hover:bg-primary/20"
              >
                <Play className="h-3.5 w-3.5 fill-current" /> Launch setup{" "}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-background/30">
                {courtImage ? (
                  <div
                    className="h-20 bg-cover bg-center"
                    style={{
                      backgroundImage: `linear-gradient(180deg, transparent, rgba(3, 15, 25, .9)), url(${courtImage})`,
                    }}
                  >
                    <span className="inline-block px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-white">
                      Home court
                    </span>
                  </div>
                ) : (
                  <p className="px-3 py-2 text-[10px] text-muted-foreground">
                    Add a home-court photo from your profile.
                  </p>
                )}
              </div>
            </section>
          </div>

          <div
            className={
              layout === "compact"
                ? "grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
                : "grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            }
          >
            <StatCard
              icon={<Trophy />}
              label="Win rate"
              value={`${stats.winRate}%`}
              detail={`${stats.wins} wins · ${stats.losses} losses`}
            />
            <StatCard
              icon={<Flame />}
              label="Current streak"
              value={`${stats.streak}`}
              detail={stats.streak ? "wins in a row" : "start a new streak"}
            />
            <StatCard
              icon={<Gauge />}
              label="Average margin"
              value={`${stats.avgMargin}`}
              detail="points per game"
            />
            <StatCard
              icon={<Swords />}
              label="Deciders"
              value={`${stats.deciderWins}/${stats.decisiveGames}`}
              detail="deciding games won"
            />
          </div>

          <section className="bento-tile p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">
                  <Trophy className="h-3.5 w-3.5" /> Player badges
                </p>
                <h2 className="mt-1 font-display text-lg font-semibold">Your court identity</h2>
              </div>
              <span className="text-[10px] text-muted-foreground">Earned automatically</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {getBadges(stats).map((badge) => (
                <span
                  key={badge.label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary"
                >
                  <Trophy className="h-3 w-3" />
                  {badge.label}
                </span>
              ))}
            </div>
          </section>
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <section className="bento-tile p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="eyebrow">
                    <History className="h-3.5 w-3.5" /> Recent form
                  </p>
                  <h2 className="mt-1 font-display text-lg font-semibold">Your last five</h2>
                </div>
                <Link to="/history" className="text-xs font-semibold text-primary hover:underline">
                  Full history <ChevronRight className="inline h-3.5 w-3.5" />
                </Link>
              </div>
              {recent.length ? (
                <div className="space-y-2">
                  {recent.map((m) => (
                    <FormRow key={m.id} match={m} />
                  ))}
                </div>
              ) : (
                <EmptyState text="Your match story starts with the first saved result." />
              )}
            </section>
            <section className="bento-tile p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="eyebrow">
                    <Sparkles className="h-3.5 w-3.5" /> Coach's corner
                  </p>
                  <h2 className="mt-1 font-display text-lg font-semibold">
                    A note for your next session
                  </h2>
                </div>
                <Link to="/ai" className="text-xs font-semibold text-primary hover:underline">
                  Open AI <ChevronRight className="inline h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                <p className="text-sm leading-6 text-foreground">
                  {getCoachNote(stats, lastMatch, coachingTone, terminology)}
                </p>
                <div className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5 text-primary" />
                  {lastMatch
                    ? `Based on ${formatDate(lastMatch.started_at)}`
                    : "Ready when you are"}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Link
                  to="/video"
                  className="rounded-xl border border-white/10 bg-background/40 px-3 py-2.5 text-xs font-semibold transition hover:border-primary/30"
                >
                  <Play className="mr-1.5 inline h-3.5 w-3.5 text-primary" />
                  Analyze a rally
                </Link>
                <Link
                  to="/history"
                  className="rounded-xl border border-white/10 bg-background/40 px-3 py-2.5 text-xs font-semibold transition hover:border-primary/30"
                >
                  <History className="mr-1.5 inline h-3.5 w-3.5 text-primary" />
                  Review patterns
                </Link>
              </div>
            </section>
          </div>

          <section className="bento-tile p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="eyebrow">
                  <Trophy className="h-3.5 w-3.5" /> Your progress
                </p>
                <h2 className="mt-1 font-display text-lg font-semibold">
                  {progressQ.data?.progress.level_name ?? "New Player"}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {progressQ.data?.progress.total_xp ?? 0} XP earned through matches, reflection,
                  and focus.
                </p>
              </div>
              <Link to="/progress" className="text-xs font-semibold text-primary hover:underline">
                Open progress <ChevronRight className="inline h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
                  Coach quest
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {progressQ.data?.activeQuest?.title ?? "Build your baseline"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {progressQ.data?.activeQuest?.progress ?? 0} /{" "}
                  {progressQ.data?.activeQuest?.target_value ?? 1} complete
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-background/30 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
                  Player identity
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {progressQ.data?.insights?.[0]?.label ?? "Your first pattern is forming"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {progressQ.data?.insights?.[0]?.description ??
                    "Save a match to unlock personalized insights."}
                </p>
              </div>
            </div>
          </section>

          <section className="bento-tile p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="eyebrow">
                  <Plus className="h-3.5 w-3.5" /> Your shortcuts
                </p>
                <h2 className="mt-1 font-display text-lg font-semibold">Built around your game</h2>
              </div>
              <Link to="/profile" className="text-xs font-semibold text-primary hover:underline">
                Customize <ChevronRight className="inline h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { to: "/scoreboard", label: "Live scoreboard", icon: <Trophy /> },
                { to: "/ai", label: "AI Referee", icon: <Sparkles /> },
                { to: "/history", label: "Match history", icon: <History /> },
                { to: "/social", label: "Find a partner", icon: <Users /> },
              ].map((s) => (
                <Link
                  key={s.to}
                  to={s.to}
                  className="group flex items-center gap-3 rounded-xl border border-white/10 bg-background/30 px-3 py-3 transition hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/5"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {s.icon}
                  </span>
                  <span className="flex-1 text-xs font-semibold">{s.label}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                </Link>
              ))}
            </div>
          </section>
        </div>
      </details>
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="h-48 animate-pulse rounded-3xl border border-white/10 bg-card/60" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-48 animate-pulse rounded-2xl border border-white/10 bg-card/50" />
        <div className="h-48 animate-pulse rounded-2xl border border-white/10 bg-card/50" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-20 animate-pulse rounded-2xl border border-white/10 bg-card/50"
          />
        ))}
      </div>
    </div>
  );
}

function DashboardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="app-state mx-auto max-w-xl text-center">
      <p className="eyebrow text-primary">Dashboard unavailable</p>
      <h1 className="app-state-title">We could not load your court view.</h1>
      <p className="app-state-description">Check your connection and try again.</p>
      <button type="button" onClick={onRetry} className="button-primary mt-6">
        Try again
      </button>
    </div>
  );
}

function isThisWeek(date: string) {
  const d = new Date(date);
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  start.setHours(0, 0, 0, 0);
  return d >= start;
}
function formatDate(date: string) {
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function getStats(matches: Match[]) {
  const finished = matches.filter((m) => m.winner);
  let wins = 0,
    margin = 0,
    games = 0,
    decisiveGames = 0,
    deciderWins = 0;
  for (const m of finished) {
    const won = m.winner === "A";
    wins += won ? 1 : 0;
    const isDecider = m.games.length >= 3;
    if (isDecider) {
      decisiveGames++;
      if (m.games[m.games.length - 1]?.a > m.games[m.games.length - 1]?.b === won) deciderWins++;
    }
    for (const g of m.games) {
      margin += Math.abs(g.a - g.b);
      games++;
    }
  }
  let streak = 0;
  for (const m of finished) {
    if (m.winner === "A") streak++;
    else break;
  }
  return {
    wins,
    losses: Math.max(0, finished.length - wins),
    winRate: finished.length ? Math.round((wins / finished.length) * 100) : 0,
    streak,
    avgMargin: games ? (margin / games).toFixed(1) : "0.0",
    decisiveGames,
    deciderWins,
  };
}
function getUsualMatch(matches: Match[], profile: any) {
  const last = matches[0];
  if (!last)
    return {
      title: profile?.home_court ? `At ${profile.home_court}` : "Make it yours",
      subtitle: "Save a match to create your one-tap setup.",
      mode: "singles",
      preset: "21",
      names: ["You", "Opponent"],
    };
  const opponent = last.team_b_names?.join(" & ") || "your usual rival";
  return {
    title: `${last.mode === "doubles" ? "Doubles" : "Singles"} · ${opponent}`,
    subtitle: `${last.format}${profile?.home_court ? ` · ${profile.home_court}` : ""} · from your last session`,
    mode: last.mode,
    preset: last.format,
    names: [last.team_a_names?.join(" & ") || "You", opponent],
  };
}
function getCoachNote(
  stats: ReturnType<typeof getStats>,
  last: Match | undefined,
  tone: DashboardPrefs["coaching_tone"],
  terms: { rally: string; match: string },
) {
  const rally = terms.rally.toLowerCase();
  const match = terms.match.toLowerCase();
  if (!last)
    return tone === "blunt"
      ? `You have no data yet. Log a ${match}.`
      : `Log your first ${match} and I will turn the result into a focused training note.`;
  if (stats.streak >= 3) {
    if (tone === "technical")
      return `Pattern: ${stats.streak} consecutive wins. Test this in a deciding ${match} and track your ${rally} quality under fatigue.`;
    if (tone === "competitive")
      return `You are on a ${stats.streak}-${match} streak. Raise the level and prove it against stronger opposition.`;
    if (tone === "blunt")
      return `You are winning. Stop coasting: test your game in a deciding ${match}.`;
    return `You are carrying a ${stats.streak}-${match} win streak. Keep the confidence, then pressure-test it next session.`;
  }
  if (stats.avgMargin !== "0.0")
    return tone === "technical"
      ? `Average margin: ${stats.avgMargin} points per game. Work on closing the final three points of each ${rally}.`
      : `Your average margin is ${stats.avgMargin} points. Find one repeatable way to protect the lead when ${rally}s get tight.`;
  return `Your next ${match} is a chance to establish a baseline. Add a note after you play and your coaching feed will get sharper.`;
}
function getBadges(stats: ReturnType<typeof getStats>) {
  const badges: Array<{ label: string }> = [];
  if (stats.wins >= 1) badges.push({ label: "First win" });
  if (stats.streak >= 3) badges.push({ label: "On a streak" });
  if (stats.decisiveGames >= 3) badges.push({ label: "Decider tested" });
  if (stats.avgMargin !== "0.0") badges.push({ label: "Margin tracker" });
  return badges.length ? badges : [{ label: "New player" }];
}
function StatCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="bento-tile p-4 transition hover:-translate-y-0.5">
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <span className="eyebrow !tracking-[0.12em]">{label}</span>
      </div>
      <div className="mt-3 font-display text-3xl font-bold">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{detail}</div>
    </div>
  );
}

function CompactStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bento-tile min-w-0 p-3 sm:p-4">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate font-display text-base font-semibold text-foreground sm:text-lg">
        {value}
      </p>
    </div>
  );
}
function FormRow({ match }: { match: Match }) {
  const won = match.winner === "A";
  const opponent = match.team_b_names?.join(" & ") || "Opponent";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-background/30 px-3 py-2.5">
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ${won ? "bg-primary/15 text-primary" : "bg-destructive/10 text-destructive"}`}
      >
        {won ? "W" : "L"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold">vs {opponent}</div>
        <div className="text-[10px] text-muted-foreground">
          {match.mode} · {formatDate(match.started_at)}
        </div>
      </div>
      <div className="text-right text-xs font-semibold">
        {(match.games ?? []).map((g) => `${g.a}-${g.b}`).join(" · ")}
      </div>
    </div>
  );
}
function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}
