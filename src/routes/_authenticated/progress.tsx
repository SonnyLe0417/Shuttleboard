import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Flame, Gauge, Sparkles, Trophy } from "lucide-react";
import { getProgressSummary, updateProgressSettings } from "@/lib/progress.functions";

export const Route = createFileRoute("/_authenticated/progress")({
  head: () => ({ meta: [{ title: "Progress · ShuttleBoard" }] }),
  component: ProgressPage,
});

const achievements = [
  ["first-match", "First Match", "Save your first completed result."],
  ["first-reflection", "First Reflection", "Write your first post-match lesson."],
  ["first-personal-best", "Personal Best", "Set a new best in any tracked category."],
  ["three-match-streak", "On a Streak", "Win three completed matches in a row."],
  ["five-reflections", "Court Journal", "Complete five reflections."],
  ["three-quests", "Focused Player", "Complete three coach quests."],
  ["decider-tested", "Decider Tested", "Finish three matches with a deciding game."],
  ["comeback", "Comeback Match", "Win after falling behind in a game."],
  ["opponent-analyst", "Opponent Analyst", "Save a private strategy memory."],
  ["consistent-player", "Consistent Player", "Play two matches in a period."],
] as const;

function ProgressPage() {
  const qc = useQueryClient();
  const fetchProgress = useServerFn(getProgressSummary);
  const saveSettings = useServerFn(updateProgressSettings);
  const progressQ = useQuery({ queryKey: ["progress", "summary"], queryFn: () => fetchProgress() });
  const [cadence, setCadence] = useState<"weekly" | "monthly">("weekly");
  const [streaksEnabled, setStreaksEnabled] = useState(true);
  const [celebrationEnabled, setCelebrationEnabled] = useState(true);
  const settingsMutation = useMutation({
    mutationFn: (data: {
      quest_cadence?: "weekly" | "monthly";
      streaks_enabled?: boolean;
      celebration_enabled?: boolean;
    }) => saveSettings({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["progress", "summary"] });
      toast.success("Coach quest cadence updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const summary = progressQ.data;
  useEffect(() => {
    if (!summary?.progress) return;
    setCadence(summary.progress.quest_cadence ?? "weekly");
    setStreaksEnabled(summary.progress.streaks_enabled ?? true);
    setCelebrationEnabled(summary.progress.celebration_enabled ?? true);
  }, [summary?.progress]);
  const earned = new Set((summary?.achievements ?? []).map((item: any) => item.achievement_key));
  const level = summary?.progress.current_level ?? 1;
  const xp = summary?.progress.total_xp ?? 0;
  const nextLevel =
    [100, 250, 500, 850, 1300, 1850, 2500].find((threshold) => threshold > xp) ?? xp + 700;

  return (
    <div className="space-y-6">
      <header className="rounded-3xl border border-primary/20 bg-card/70 p-6 shadow-[0_20px_80px_oklch(0.16_0.04_190/0.3)] sm:p-8">
        <p className="eyebrow text-primary">
          <Sparkles className="h-3.5 w-3.5" /> Player progress
        </p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold sm:text-5xl">
              {summary?.progress.level_name ?? "New Player"}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              A private improvement record built from the work you actually do on court.
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-primary">{xp} XP</p>
            <p className="text-xs text-muted-foreground">
              Level {level} · {Math.max(0, nextLevel - xp)} to next
            </p>
          </div>
        </div>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="animate-progress-fill h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.min(100, Math.max(8, (xp / nextLevel) * 100))}%` }}
          />
        </div>
      </header>

      {summary?.setupRequired && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          Progress is in preview mode because the Supabase migration has not been applied yet. Your
          existing match insights still work; XP, quests, achievements, and saved reflections will
          activate after the migration is deployed.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="bento-tile p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="eyebrow">
                <Gauge className="h-3.5 w-3.5" /> Player identity
              </p>
              <h2 className="mt-1 font-display text-xl font-semibold">Patterns worth noticing</h2>
            </div>
            <span className="text-xs text-muted-foreground">Match data first</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(summary?.insights ?? []).map((insight: any) => (
              <div
                key={insight.key}
                className="interactive-lift rounded-xl border border-white/10 bg-background/30 p-3"
              >
                <p className="text-sm font-semibold">{insight.label}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {insight.description}
                </p>
                <span className="mt-2 inline-flex text-[10px] uppercase tracking-[0.12em] text-primary">
                  {insight.confidence}
                </span>
              </div>
            ))}
            {!summary?.insights?.length && (
              <p className="text-sm text-muted-foreground">
                Save a completed match to unlock your first pattern.
              </p>
            )}
          </div>
        </section>
        <section className="bento-tile interactive-lift p-5">
          <p className="eyebrow">
            <Flame className="h-3.5 w-3.5" /> Coach quest
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold">
            {summary?.activeQuest?.title ?? "Build your baseline"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {summary?.activeQuest?.description ??
              "Your first quest appears after you save a match."}
          </p>
          <div className="mt-4 flex items-center justify-between text-xs">
            <span>
              {summary?.activeQuest?.progress ?? 0} / {summary?.activeQuest?.target_value ?? 1}
            </span>
            <span className="text-primary">{summary?.activeQuest?.cadence ?? "weekly"}</span>
          </div>
        </section>
      </div>

      <section className="bento-tile p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">
              <Trophy className="h-3.5 w-3.5" /> Achievements
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold">
              Earn rewards for improvement
            </h2>
          </div>
          <label className="text-xs text-muted-foreground">
            Quest cadence{" "}
            <select
              value={cadence}
              onChange={(event) => {
                const next = event.target.value as "weekly" | "monthly";
                setCadence(next);
                settingsMutation.mutate({ quest_cadence: next });
              }}
              className="ml-2 rounded-lg border border-white/10 bg-background px-2 py-1 text-xs"
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {achievements.map(([key, title, description]) => {
            const isEarned = earned.has(key);
            return (
              <div
                key={key}
                className={`interactive-lift rounded-xl border p-3 ${isEarned ? "border-primary/30 bg-primary/10" : "border-white/10 bg-background/20 opacity-70"}`}
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                    {isEarned ? (
                      <Check className="animate-check-pop h-3.5 w-3.5" />
                    ) : (
                      <Trophy className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <p className="text-sm font-semibold">{title}</p>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>
                <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-primary">
                  {isEarned ? "Earned" : "Locked"}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bento-tile p-5">
        <p className="eyebrow">
          <Sparkles className="h-3.5 w-3.5" /> Personal controls
        </p>
        <h2 className="mt-1 font-display text-xl font-semibold">Choose how progress feels</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between rounded-xl border border-white/10 bg-background/30 px-3 py-3 text-sm">
            Show streaks
            <input
              type="checkbox"
              checked={streaksEnabled}
              onChange={(event) => {
                const value = event.target.checked;
                setStreaksEnabled(value);
                settingsMutation.mutate({ streaks_enabled: value });
              }}
            />
          </label>
          <label className="flex items-center justify-between rounded-xl border border-white/10 bg-background/30 px-3 py-3 text-sm">
            Celebrate unlocks
            <input
              type="checkbox"
              checked={celebrationEnabled}
              onChange={(event) => {
                const value = event.target.checked;
                setCelebrationEnabled(value);
                settingsMutation.mutate({ celebration_enabled: value });
              }}
            />
          </label>
        </div>
      </section>

      <section className="bento-tile p-5">
        <p className="eyebrow">
          <Trophy className="h-3.5 w-3.5" /> Personal bests
        </p>
        <h2 className="mt-1 font-display text-xl font-semibold">Your best work</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(summary?.personalBests ?? []).map((best: any) => (
            <div
              key={best.metric_key}
              className="rounded-xl border border-white/10 bg-background/30 p-3"
            >
              <p className="text-xs text-muted-foreground">
                {best.metric_key.replaceAll("_", " ")}
              </p>
              <p className="mt-1 text-lg font-bold text-primary">
                {best.value} {best.unit}
              </p>
            </div>
          ))}
          {!summary?.personalBests?.length && (
            <p className="text-sm text-muted-foreground">
              Personal bests will appear as your match history grows.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
