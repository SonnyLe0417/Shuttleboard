import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Edit3,
  Flame,
  Medal,
  Sparkles,
  Target,
  Trophy,
  Users,
  Zap,
} from "lucide-react";

type ProfileProgressHomeProps = {
  profile: any;
  avatarPreview: string;
  bannerImage: string;
  summary: any;
  friends: any[];
  editHref: string;
};

const paths = [
  { key: "rally", label: "Rally Control", description: "Build consistency under pressure." },
  { key: "confidence", label: "Match Confidence", description: "Turn practice into match habits." },
  { key: "singles", label: "Singles", description: "Track your one-on-one game." },
  { key: "doubles", label: "Doubles", description: "Grow your partnership play." },
  { key: "reflection", label: "Reflection", description: "Learn something after every match." },
];

export function ProfileProgressHome({
  profile,
  avatarPreview,
  bannerImage,
  summary,
  friends,
  editHref,
}: ProfileProgressHomeProps) {
  const progress = summary?.progress ?? {};
  const stats = summary?.stats ?? {};
  const xp = Number(progress.total_xp ?? 0);
  const level = Number(progress.current_level ?? 1);
  const nextLevel =
    [100, 250, 500, 850, 1300, 1850, 2500].find((threshold) => threshold > xp) ?? xp + 700;
  const levelProgress = Math.min(100, Math.max(6, (xp / nextLevel) * 100));
  const matches = Number(stats.matches ?? 0);
  const earned = new Set((summary?.achievements ?? []).map((item: any) => item.achievement_key));
  const pathProgress = (key: string) => {
    if (key === "singles") return Math.min(100, Number(stats.singles ?? 0) * 14);
    if (key === "doubles") return Math.min(100, Number(stats.doubles ?? 0) * 14);
    if (key === "reflection") return earned.has("first-reflection") ? 65 : matches ? 20 : 0;
    if (key === "confidence")
      return Math.min(100, Number(stats.currentStreak ?? 0) * 18 + matches * 4);
    return Math.min(100, matches * 9 + Number(stats.winRate ?? 0) / 4);
  };

  return (
    <div className="space-y-5">
      <section
        className="relative overflow-hidden rounded-3xl border border-primary/25 bg-card/80 shadow-[0_22px_90px_oklch(0.12_0.04_190/0.4)] animate-fade-up"
        style={
          bannerImage
            ? {
                backgroundImage: `linear-gradient(110deg, rgba(4, 19, 30, .96), rgba(4, 19, 30, .72)), url(${bannerImage})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        <div className="absolute -right-16 -top-20 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-end sm:p-7">
          <div className="relative shrink-0">
            <div className="h-24 w-24 overflow-hidden rounded-3xl border-4 border-primary/40 bg-primary/15 shadow-xl sm:h-28 sm:w-28">
              {avatarPreview ? (
                <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-3xl font-bold text-primary">
                  {(profile?.display_name ?? "S").slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <span className="absolute -bottom-2 -right-2 inline-flex items-center gap-1 rounded-full border border-primary/40 bg-background px-2 py-1 text-[10px] font-bold text-primary">
              <Zap className="h-3 w-3" /> L{level}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="eyebrow text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Your court story
            </p>
            <h1 className="mt-2 truncate font-display text-3xl font-bold sm:text-4xl">
              {profile?.display_name ?? "Your profile"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              @{profile?.handle ?? "player"}{" "}
              {profile?.home_court
                ? `· ${profile.home_court}`
                : "· Keep showing up, one match at a time."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <a
              href={editHref}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
            >
              <Edit3 className="h-3.5 w-3.5" /> Edit profile
            </a>
            <Link
              to="/progress"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition hover:bg-primary/20"
            >
              Full progress <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        <StatCard icon={<Zap />} label="XP" value={xp.toLocaleString()} detail={`Level ${level}`} />
        <StatCard
          icon={<Flame />}
          label="Current streak"
          value={`${stats.currentStreak ?? 0}`}
          detail="match wins"
        />
        <StatCard
          icon={<Trophy />}
          label="Personal bests"
          value={`${summary?.personalBests?.length ?? 0}`}
          detail="records tracked"
        />
        <StatCard
          icon={<Medal />}
          label="Achievements"
          value={`${summary?.achievements?.length ?? 0}`}
          detail="unlocked"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
        <div className="bento-tile interactive-lift p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow text-primary">
                <Target className="h-3.5 w-3.5" /> Level {level} ·{" "}
                {progress.level_name ?? "New Player"}
              </p>
              <h2 className="mt-1 font-display text-xl font-semibold">Keep the rally going</h2>
            </div>
            <span className="text-xs text-muted-foreground">
              {Math.max(0, nextLevel - xp)} XP to next
            </span>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
            <div
              className="animate-progress-fill h-full rounded-full bg-gradient-to-r from-primary to-cyan-300"
              style={{ width: `${levelProgress}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>{xp} XP</span>
            <span>{nextLevel} XP</span>
          </div>
        </div>
        <div className="bento-tile interactive-lift p-5">
          <p className="eyebrow">
            <Flame className="h-3.5 w-3.5" /> Coach’s Corner
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold">
            {summary?.activeQuest?.title ?? "Start your match story"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {summary?.activeQuest?.description ?? "Save a match to unlock a personalized quest."}
          </p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-primary"
              style={{
                width: `${Math.min(100, ((summary?.activeQuest?.progress ?? 0) / Math.max(1, summary?.activeQuest?.target_value ?? 1)) * 100)}%`,
              }}
            />
          </div>
        </div>
      </section>

      <section className="bento-tile p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="eyebrow text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Training paths
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold">Choose what to grow next</h2>
          </div>
          <span className="text-xs text-muted-foreground">Match data first</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {paths.map((path) => {
            const value = pathProgress(path.key);
            return (
              <div
                key={path.key}
                className="interactive-lift rounded-2xl border border-white/10 bg-background/30 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{path.label}</p>
                  <span className="text-[10px] text-primary">{Math.round(value)}%</span>
                </div>
                <p className="mt-1 min-h-10 text-xs leading-5 text-muted-foreground">
                  {path.description}
                </p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="animate-progress-fill h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(value, value ? 8 : 3)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="bento-tile p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="eyebrow">
                <Trophy className="h-3.5 w-3.5" /> Personal bests
              </p>
              <h2 className="mt-1 font-display text-xl font-semibold">Small records, real proof</h2>
            </div>
            <Link to="/progress" className="text-xs text-primary">
              See all
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            {(summary?.personalBests ?? []).slice(0, 3).map((best: any) => (
              <div
                key={best.metric_key}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-background/30 px-3 py-2.5"
              >
                <span className="text-sm capitalize">
                  {String(best.metric_key).replaceAll("_", " ")}
                </span>
                <span className="font-semibold text-primary">
                  {best.value} {best.unit}
                </span>
              </div>
            ))}
            {!summary?.personalBests?.length && (
              <p className="text-sm text-muted-foreground">
                Your first saved match can create your first record.
              </p>
            )}
          </div>
        </section>
        <section className="bento-tile p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="eyebrow">
                <Users className="h-3.5 w-3.5" /> Friends
              </p>
              <h2 className="mt-1 font-display text-xl font-semibold">Your court circle</h2>
            </div>
            <Link to="/social" className="text-xs text-primary">
              Manage friends
            </Link>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {friends.slice(0, 6).map((friend: any) => (
              <div
                key={friend.id}
                className="flex items-center gap-2 rounded-full border border-white/10 bg-background/30 px-2.5 py-1.5"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                  {(friend.other?.display_name ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="max-w-24 truncate text-xs">
                  {friend.other?.display_name ?? "Player"}
                </span>
              </div>
            ))}
            {!friends.length && (
              <p className="text-sm text-muted-foreground">
                Add friends to build your court circle.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
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
    <div className="bento-tile interactive-lift p-4">
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-[0.14em]">{label}</span>
      </div>
      <p className="mt-2 font-display text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
