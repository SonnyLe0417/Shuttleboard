import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowUpRight,
  BadgeCheck,
  CalendarDays,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  Trophy,
} from "lucide-react";

const officialRankingsUrl = "https://usabjrrankings.org/";
const usabJuniorPageUrl = "https://usabadminton.org/athletes/juniors/junior-rankings/";

export const Route = createFileRoute("/_authenticated/junior-rankings")({
  ssr: false,
  head: () => ({ meta: [{ title: "USAB Junior Rankings · ShuttleBoard" }] }),
  component: JuniorRankingsPage,
});

function JuniorRankingsPage() {
  return (
    <div className="space-y-6">
      <header className="club-page-heading relative overflow-hidden rounded-3xl border border-primary/20 bg-card/70 p-6 shadow-[0_20px_80px_oklch(0.16_0.04_190/0.3)] sm:p-8">
        <div className="pointer-events-none absolute -right-12 -top-20 h-56 w-56 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="eyebrow">
              <Trophy className="h-3.5 w-3.5" /> Official junior rankings
            </p>
            <h1 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight sm:text-5xl">
              Track your path through USAB.
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              View the current USA Badminton junior standings by event, age group, ranking date, and
              USAB ID from the official source.
            </p>
          </div>
          <a
            href={officialRankingsUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-primary-glow inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold"
          >
            Open live rankings <ArrowUpRight className="h-4 w-4" />
          </a>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <InfoCard
          icon={<CalendarDays className="h-4 w-4" />}
          title="Ranking dates"
          copy="Choose the latest published list or compare an earlier USAB update."
        />
        <InfoCard
          icon={<BadgeCheck className="h-4 w-4" />}
          title="Five events"
          copy="Boys’ singles, girls’ singles, boys’ doubles, girls’ doubles, and mixed doubles."
        />
        <InfoCard
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Official source"
          copy="Names, points, and positions are maintained by USA Badminton—not estimated by ShuttleBoard."
        />
      </section>

      <section className="bento-tile overflow-hidden p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">
              <Sparkles className="h-3.5 w-3.5" /> Rankings hub
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold">Find your division</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              The official rankings site has the live table and filters for U11, U13, U15, U17, and
              U19. Open it to search by name or USAB ID and select the exact event you play.
            </p>
          </div>
          <span className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
            Live official data
          </span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {["U11", "U13", "U15", "U17", "U19"].map((age) => (
            <a
              key={age}
              href={officialRankingsUrl}
              target="_blank"
              rel="noreferrer"
              className="group rounded-2xl border border-white/10 bg-background/35 p-4 transition hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/5"
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Age group
              </span>
              <span className="mt-1 flex items-center justify-between font-display text-2xl font-bold text-foreground">
                {age}
                <ExternalLink className="h-4 w-4 text-muted-foreground transition group-hover:text-primary" />
              </span>
            </a>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="bento-tile p-5 sm:p-6">
          <p className="eyebrow">How to use this page</p>
          <div className="mt-4 space-y-3">
            <Step
              number="01"
              title="Open the live rankings"
              copy="Use the official USAB table so you always see the newest published list."
            />
            <Step
              number="02"
              title="Choose your event and age group"
              copy="Filter the table to your singles or doubles event and current junior division."
            />
            <Step
              number="03"
              title="Search your name or USAB ID"
              copy="Use the official athlete profile to confirm your points and position."
            />
          </div>
        </div>
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6">
          <p className="eyebrow">Official results</p>
          <h2 className="mt-2 font-display text-xl font-semibold">Keep your standing current.</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Use the official USAB rankings table for your published points, position, age group, and
            event. ShuttleBoard helps you prepare between tournaments.
          </p>
          <a
            href={officialRankingsUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            View official results <ArrowUpRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      <p className="text-center text-[11px] text-muted-foreground">
        Official ranking information is provided by USA Badminton.{" "}
        <a
          href={usabJuniorPageUrl}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          Learn more on USAB.org
        </a>
        .
      </p>
    </div>
  );
}

function InfoCard({ icon, title, copy }: { icon: React.ReactNode; title: string; copy: string }) {
  return (
    <div className="bento-tile p-4">
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{copy}</p>
    </div>
  );
}

function Step({ number, title, copy }: { number: string; title: string; copy: string }) {
  return (
    <div className="flex gap-3">
      <span className="font-display text-sm font-bold text-primary">{number}</span>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{copy}</p>
      </div>
    </div>
  );
}
