import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Clock3, MapPin, Palette, Play, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/match-lobby")({
  ssr: false,
  head: () => ({ meta: [{ title: "Match lobby · ShuttleBoard" }] }),
  component: MatchLobbyPage,
});

const TEAM_COLORS = ["#2dd4a8", "#38bdf8", "#f59e0b", "#f43f5e", "#a855f7"];

function MatchLobbyPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"singles" | "doubles">("singles");
  const [title, setTitle] = useState("");
  const [court, setCourt] = useState("");
  const [teamA, setTeamA] = useState("You");
  const [teamB, setTeamB] = useState("");
  const [colorA, setColorA] = useState(TEAM_COLORS[0]);
  const [colorB, setColorB] = useState(TEAM_COLORS[1]);
  const [warmup, setWarmup] = useState("none");
  const isDoubles = mode === "doubles";

  useEffect(() => {
    try {
      const raw = localStorage.getItem("shuttleboard.rematch.v1");
      if (!raw) return;
      const rematch = JSON.parse(raw) as {
        mode?: "singles" | "doubles";
        category?: string;
        title?: string;
        court?: string;
        teamA?: string;
        teamB?: string;
      };
      if (rematch.mode) setMode(rematch.mode);
      else if (rematch.category?.includes("doubles")) setMode("doubles");
      if (rematch.title) setTitle(rematch.title);
      if (rematch.court) setCourt(rematch.court);
      if (rematch.teamA) setTeamA(rematch.teamA);
      if (rematch.teamB) setTeamB(rematch.teamB);
      localStorage.removeItem("shuttleboard.rematch.v1");
    } catch {
      localStorage.removeItem("shuttleboard.rematch.v1");
    }
  }, []);

  function launch() {
    localStorage.setItem(
      "shuttleboard.match-lobby.v1",
      JSON.stringify({
        mode,
        title: title || `${isDoubles ? "Doubles" : "Singles"} session`,
        court,
        teamA,
        teamB: teamB || "Opponent",
        colorA,
        colorB,
        warmup,
      }),
    );
    navigate({ to: "/scoreboard" });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="club-page-heading flex items-start gap-3">
        <Link
          to="/dashboard"
          aria-label="Back to dashboard"
          className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <p className="eyebrow">Play / Match setup</p>
          <h1 className="mt-2 font-display text-3xl font-bold">Ready for a game?</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick your format, add the players, and take the court.
          </p>
        </div>
      </header>
      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="bento-tile space-y-5 p-5 sm:p-6">
          <div>
            <p className="eyebrow">
              <Users className="h-3.5 w-3.5" /> Match format
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {(
                [
                  { id: "singles", label: "Singles", copy: "One player per side" },
                  { id: "doubles", label: "Doubles", copy: "Two players per side" },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  onClick={() => setMode(option.id)}
                  className={`rounded-xl border p-3 text-left transition ${mode === option.id ? "border-primary/50 bg-primary/10 shadow-[var(--shadow-glow)]" : "border-white/10 bg-background/30 hover:border-white/20"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{option.label}</span>
                    {mode === option.id && <Check className="h-4 w-4 text-primary" />}
                  </div>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {option.copy}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Match title"
              placeholder={isDoubles ? "Friday doubles league" : "Practice vs. Alex"}
              value={title}
              onChange={setTitle}
            />
            <Field
              label="Court"
              placeholder="Home court or venue"
              value={court}
              onChange={setCourt}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={isDoubles ? "Your team" : "You"}
              placeholder={isDoubles ? "You & partner" : "Your name"}
              value={teamA}
              onChange={setTeamA}
            />
            <Field
              label={isDoubles ? "Opposing team" : "Opponent"}
              placeholder={isDoubles ? "Opponent team" : "Walk-on player"}
              value={teamB}
              onChange={setTeamB}
            />
          </div>
          <div>
            <p className="eyebrow">
              <Palette className="h-3.5 w-3.5" /> Team colors
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              {[colorA, colorB].map((color, team) => (
                <div
                  key={team}
                  className="flex items-center gap-2 rounded-full border border-white/10 bg-background/30 px-3 py-1.5"
                >
                  <span className="h-4 w-4 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-xs text-muted-foreground">
                    Team {team === 0 ? "A" : "B"}
                  </span>
                  <div className="ml-1 flex gap-1">
                    {TEAM_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => (team === 0 ? setColorA(c) : setColorB(c))}
                        className={`h-3 w-3 rounded-full ring-1 ${color === c ? "ring-foreground" : "ring-transparent"}`}
                        style={{ backgroundColor: c }}
                        aria-label={`Use ${c}`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="bento-tile flex flex-col p-5 sm:p-6">
          <div>
            <p className="eyebrow">
              <Clock3 className="h-3.5 w-3.5" /> Warm-up
            </p>
            <h2 className="mt-2 font-display text-xl font-semibold">Arrive ready.</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Start with a calm countdown or go straight to scoring.
            </p>
          </div>
          <div className="mt-4 space-y-2">
            {[
              { id: "none", label: "Start immediately" },
              { id: "3", label: "3 minute warm-up" },
              { id: "5", label: "5 minute warm-up" },
            ].map((w) => (
              <button
                key={w.id}
                onClick={() => setWarmup(w.id)}
                className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left text-sm transition ${warmup === w.id ? "border-primary/40 bg-primary/10" : "border-white/10 bg-background/30"}`}
              >
                {w.label}
                {warmup === w.id && <Check className="h-4 w-4 text-primary" />}
              </button>
            ))}
          </div>
          <div className="mt-auto pt-6">
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-3 text-xs text-muted-foreground">
              <MapPin className="h-4 w-4 text-primary" />
              {court || "Court details will appear in the recap"}
            </div>
            <button
              onClick={launch}
              className="btn-primary-glow flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold"
            >
              <Play className="h-4 w-4 fill-current" /> Enter match{" "}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/10 bg-background/40 px-3 py-2.5 text-sm outline-none transition focus:border-primary/50"
        maxLength={60}
      />
    </label>
  );
}
