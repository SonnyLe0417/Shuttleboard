import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  CirclePlay,
  Gauge,
  Menu,
  Sparkles,
  Trophy,
  Users,
  Video,
} from "lucide-react";
import { useSession } from "@/hooks/useSession";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ShuttleBoard · Your badminton game, understood" },
      {
        name: "description",
        content: "Track matches, analyze your game, and improve every rally with ShuttleBoard.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  const { user } = useSession();
  const primaryHref = user ? "/dashboard" : "/auth";
  const primaryLabel = user ? "Open dashboard" : "Start tracking free";

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#06141f] text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_55%_at_12%_6%,oklch(0.82_0.17_165/0.18),transparent_65%),radial-gradient(50%_55%_at_90%_8%,oklch(0.62_0.18_265/0.19),transparent_62%),linear-gradient(180deg,#081b2a_0%,#06141f_58%,#071c26_100%)]" />
      <div className="pointer-events-none absolute -left-40 top-40 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-48 top-[34rem] h-[32rem] w-[32rem] rounded-full bg-cyan-400/10 blur-3xl" />

      <header className="relative z-10 border-b border-white/10 bg-[#06141f]/30 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <Link to="/" className="group flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-lg text-primary-foreground shadow-[0_0_25px_oklch(0.82_0.17_165/0.45)] transition duration-300 group-hover:rotate-6 group-hover:scale-110">
              ✦
            </span>
            <span className="font-display text-base font-semibold tracking-tight">
              Shuttle<span className="gradient-text-animated">Board</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#features" className="transition hover:text-foreground">
              Features
            </a>
            <a href="#goal" className="transition hover:text-foreground">
              Our goal
            </a>
            <Link to="/scoreboard" className="transition hover:text-foreground">
              {user ? "Open scoreboard" : "Try scoreboard once"}
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/auth"
              className="hidden rounded-full px-4 py-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground sm:inline-flex"
            >
              Log in
            </Link>
            <Link
              to={primaryHref}
              className="btn-primary-glow inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold"
            >
              {user ? "Dashboard" : "Get started"}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <button
              className="rounded-lg border border-white/10 p-2 text-muted-foreground md:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:grid-cols-[0.94fr_1.06fr] lg:gap-10 lg:pb-28">
          <div className="animate-fade-up">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> Built for every
              rally
            </div>
            <h1 className="mt-6 max-w-2xl font-display text-5xl font-bold leading-[1.04] tracking-[-0.045em] sm:text-7xl">
              Your badminton game, <span className="gradient-text-animated">understood.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
              ShuttleBoard brings the scoreboard, match history, video analysis, and coaching
              feedback into one calm, intelligent place.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to={primaryHref}
                className="btn-primary-glow inline-flex items-center gap-2 rounded-xl px-5 py-3.5 text-sm font-semibold"
              >
                {primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/scoreboard"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-3.5 text-sm font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5"
              >
                <CirclePlay className="h-4 w-4 text-primary" />{" "}
                {user ? "Open scoreboard" : "Try scoreboard once"}
              </Link>
            </div>
            {!user && (
              <p className="mt-3 text-[11px] text-muted-foreground">
                One anonymous preview match. Sign up to keep your matches, history, and progress.
              </p>
            )}
            <div className="mt-9 flex flex-wrap gap-5 text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" /> Fast court-side scoring
              </span>
              <span className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" /> AI-ready analysis
              </span>
              <span className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" /> Your data, your progress
              </span>
            </div>
          </div>
          <LandingScoreboard />
        </section>

        <section
          id="features"
          className="mx-auto max-w-7xl scroll-mt-8 px-5 pb-20 sm:px-8 sm:pb-28"
        >
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow text-primary">One place for your whole game</p>
              <h2 className="mt-3 max-w-xl font-display text-3xl font-bold tracking-tight sm:text-4xl">
                Less friction between playing and improving.
              </h2>
            </div>
            <p className="max-w-sm text-sm leading-6 text-muted-foreground">
              Designed to stay out of the way during a match and give you more to work with
              afterward.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <FeatureCard
              icon={<Gauge />}
              label="Score with confidence"
              title="Court-side control"
              copy="Track every rally with serving guidance, line calls, undo, voice controls, and match-point energy."
              className="md:row-span-2"
            />
            <FeatureCard
              icon={<Video />}
              label="See what happened"
              title="AI video analysis"
              copy="Turn match footage into rally timelines, movement trends, and practical next-session focus."
            />
            <FeatureCard
              icon={<BarChart3 />}
              label="Build the full picture"
              title="Progress that sticks"
              copy="Keep your results, goals, streaks, and head-to-head history together."
            />
            <FeatureCard
              icon={<Users />}
              label="Stay connected"
              title="Your badminton circle"
              copy="Find partners, share results, and keep group conversations close to the court."
              className="md:col-span-2"
            />
          </div>
        </section>

        <section id="goal" className="mx-auto max-w-7xl scroll-mt-8 px-5 pb-20 sm:px-8 sm:pb-28">
          <div className="relative overflow-hidden rounded-[2rem] border border-primary/20 bg-[linear-gradient(135deg,oklch(0.23_0.05_205/0.9),oklch(0.17_0.04_250/0.92))] p-7 shadow-[0_25px_90px_-35px_oklch(0.82_0.17_165/0.55)] sm:p-10">
            <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-primary/15 blur-3xl" />
            <div className="relative grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
              <div>
                <p className="eyebrow text-primary">
                  <Trophy className="h-3.5 w-3.5" /> Our goal
                </p>
                <h2 className="mt-4 max-w-2xl font-display text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
                  Make improvement less mysterious—and more attainable.
                </h2>
                <p className="mt-5 max-w-2xl text-base leading-8 text-foreground/85 sm:text-lg">
                  Most players remember the score, then lose the lesson. ShuttleBoard is built to
                  preserve the detail between those two moments: the decision that changed a rally,
                  the pattern that surfaced across matches, and the next practice worth your time.
                </p>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
                  Our aim is not to turn badminton into a spreadsheet. It is to give players a
                  thoughtful record of their work—clear enough to trust, intelligent enough to
                  guide, and personal enough to return to.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                <GoalPrinciple title="Clarity" copy="Know what happened, not only who won." />
                <GoalPrinciple
                  title="Continuity"
                  copy="Carry one session's lesson into the next."
                />
                <GoalPrinciple title="Agency" copy="Turn better information into better choices." />
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 pb-20 sm:px-8 sm:pb-28">
          <div className="surface-shimmer relative overflow-hidden rounded-[2rem] border border-primary/20 bg-primary/5 p-7 sm:p-10">
            <div className="relative grid items-center gap-8 lg:grid-cols-[1fr_auto]">
              <div>
                <p className="eyebrow text-primary">
                  <Sparkles className="h-3.5 w-3.5" /> Make every session count
                </p>
                <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight sm:text-4xl">
                  Start with one match. Build a better game.
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                  Create your player profile, set your defaults, and let ShuttleBoard make the next
                  match easier to track.
                </p>
              </div>
              <Link
                to={primaryHref}
                className="btn-primary-glow inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-semibold"
              >
                {primaryLabel}
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/10 px-5 py-7 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>ShuttleBoard · Made for the next rally.</span>
          <div className="flex gap-4">
            <a href="#features" className="transition hover:text-foreground">
              Features
            </a>
            <a href="#goal" className="transition hover:text-foreground">
              Our goal
            </a>
            <Link to="/scoreboard" className="transition hover:text-foreground">
              Scoreboard
            </Link>
            <Link to="/auth" className="transition hover:text-foreground">
              Account
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function LandingScoreboard() {
  return (
    <div className="animate-scale-in relative mx-auto w-full max-w-xl lg:ml-auto">
      <div className="absolute -inset-5 rounded-[2.5rem] bg-primary/15 blur-3xl" />
      <div className="surface-shimmer relative overflow-hidden rounded-[2rem] border border-white/15 bg-[#092431]/95 p-4 shadow-[0_30px_100px_-30px_oklch(0.82_0.17_165/0.5)] sm:p-5">
        <div className="flex items-center justify-between border-b border-white/10 px-2 pb-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary shadow-[0_0_12px_var(--primary)]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
              Live match
            </span>
          </div>
          <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-muted-foreground">
            21 · Best of 3
          </span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-2 py-7 sm:gap-8 sm:py-10">
          <div>
            <p className="text-xs text-muted-foreground">Team A</p>
            <p className="mt-1 font-display text-lg font-semibold">You</p>
            <strong className="mt-3 block font-display text-6xl font-bold leading-none text-primary sm:text-8xl">
              21
            </strong>
            <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-primary">Winner</p>
          </div>
          <div className="text-center">
            <span className="text-xs text-muted-foreground">VS</span>
            <div className="mx-auto mt-3 h-12 w-px bg-gradient-to-b from-transparent via-primary/60 to-transparent" />
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Team B</p>
            <p className="mt-1 font-display text-lg font-semibold">Opponent</p>
            <strong className="mt-3 block font-display text-6xl font-bold leading-none text-foreground sm:text-8xl">
              18
            </strong>
            <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Final score
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 border-t border-white/10 pt-4">
          <MiniStat label="Rallies" value="39" />
          <MiniStat label="Streak" value="4" />
          <MiniStat label="Court" value="PBC" />
        </div>
      </div>
      <div className="animate-float absolute -bottom-5 -left-5 rounded-2xl border border-primary/25 bg-[#0b2d35]/95 px-4 py-3 shadow-[var(--shadow-glow)]">
        <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Your next goal
        </p>
        <p className="mt-1 text-sm font-semibold">
          Play twice this week <span className="ml-2 text-primary">50%</span>
        </p>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.035] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function GoalPrinciple({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
      <p className="font-display text-base font-semibold text-primary">{title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{copy}</p>
    </div>
  );
}

function FeatureCard({
  icon,
  label,
  title,
  copy,
  className = "",
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  copy: string;
  className?: string;
}) {
  return (
    <article className={`bento-tile group p-5 sm:p-6 ${className}`}>
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition duration-300 group-hover:scale-110 group-hover:rotate-3">
        {icon}
      </div>
      <p className="mt-6 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">{label}</p>
      <h3 className="mt-2 font-display text-xl font-semibold">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{copy}</p>
      <ArrowRight className="mt-6 h-4 w-4 text-primary transition duration-300 group-hover:translate-x-1" />
    </article>
  );
}
