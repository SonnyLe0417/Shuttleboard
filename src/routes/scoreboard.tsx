import { useOfflineAccount, localOfflineAccess } from "@/lib/offline-account";
import { useDurableScoreboard } from "@/hooks/useDurableScoreboard";
import { OfflineScoreboardPanel } from "@/components/badminton/OfflineScoreboardPanel";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  BadmintonMatchProvider,
  useSharedBadmintonMatch,
} from "@/components/BadmintonMatchProvider";
import { Court } from "@/components/badminton/Court";
import { landingVerdict } from "@/lib/badminton";
import { PRESETS, type PointCall, type PresetId } from "@/lib/badminton-rules";
import { matchHasStarted, totalMatchPoints } from "@/lib/match-controller";
import { getStoredPrefs } from "@/lib/themes";
import { createVoiceController, voiceSupported } from "@/lib/voice";
import { saveMatch } from "@/lib/matches.functions";
import { createMatchInvite } from "@/lib/growth.functions";
import { invalidateDashboard, MATCHES_QUERY_KEY, PROGRESS_QUERY_KEY } from "@/lib/query-keys";
import { useSession } from "@/hooks/useSession";
import { toast } from "sonner";
import {
  Trophy,
  RotateCcw,
  Undo2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Users,
  Mic,
  MicOff,
  Maximize2,
  Minimize2,
  Timer,
  FileDown,
  Share2,
  Play,
  Save,
  LockKeyhole,
  ArrowRight,
} from "lucide-react";

export const Route = createFileRoute("/scoreboard")({
  head: () => ({
    meta: [
      { title: "Scoreboard — ShuttleBoard" },
      {
        name: "description",
        content:
          "Live badminton scoreboard with rally timer, best-of-3, doubles, voice commands, and match export.",
      },
      { property: "og:title", content: "Scoreboard — ShuttleBoard" },
      {
        property: "og:description",
        content: "Premium badminton match tracking with AI line calls.",
      },
    ],
  }),
  component: ScoreboardRoute,
});

function ScoreboardRoute() {
  const session = useSession(),
    offline = useOfflineAccount();
  const supported =
    typeof indexedDB !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.locks) &&
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function";
  const prepared = localOfflineAccess(offline.account);
  if (
    supported &&
    (offline.loading ||
      (session.loading && !prepared) ||
      (session.user && offline.account?.id !== session.user.id && !offline.error))
  )
    return <ScoreboardLoading />;
  const owner = supported ? (session.user?.id ?? (prepared ? offline.account!.id : null)) : null;
  return (
    <BadmintonMatchProvider key={owner ?? "guest"} managed={Boolean(owner)}>
      <ScoreboardPage owner={owner} />
    </BadmintonMatchProvider>
  );
}

function ScoreboardPage({ owner }: { owner: string | null }) {
  const queryClient = useQueryClient();
  const match = useSharedBadmintonMatch();
  const durable = useDurableScoreboard(owner, match);
  const editor = useRef(durable.canEdit);
  editor.current = durable.canEdit;
  const { user, loading: sessionLoading, error: sessionError } = useSession();
  const signedInId = user?.id;
  const { ready: localReady, canEdit: localCanEdit, setMeta: setLocalMeta } = durable;
  const {
    state,
    setName,
    setDoublesName,
    setMode,
    setDeclaredSide,
    setServeCheck,
    setNearSide,
    setFirstServer,
    setPreset,
    startRally,
    addPoint,
    addFault,
    undo,
    reset,
    markLanding,
    dismissCelebration,
    teamName,
    correctSide,
    sideWarning,
    pointCalls,
    matchPoint,
    gamePoint,
    doublesRotation,
    canUndo,
  } = match;

  const [rallyElapsed, setRallyElapsed] = useState(0);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceHeard, setVoiceHeard] = useState<string | null>(null);
  const [referee, setReferee] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);
  const [savedHistoryKey, setSavedHistoryKey] = useState<string | null>(() => {
    if (owner || typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem("shuttleboard.saved-history-key.v1");
    } catch {
      return null;
    }
  });
  const [legacySavedMatchId, setSavedMatchId] = useState<string | null>(null);
  const savedMatchId = owner ? durable.savedId : legacySavedMatchId;
  const createInvite = useServerFn(createMatchInvite);
  const [warmupRemaining, setWarmupRemaining] = useState(0);
  const [trialStatus, setTrialStatus] = useState<"checking" | "available" | "used">("checking");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (owner) {
      setTrialStatus("available");
      return;
    }
    if (sessionLoading || sessionError) return;
    if (user) {
      setTrialStatus("available");
      return;
    }
    const trialKey = "shuttleboard.scoreboard-trial.v1";
    const alreadyUsed = window.localStorage.getItem(trialKey) === "used";
    if (alreadyUsed) {
      setTrialStatus("used");
      return;
    }
    window.localStorage.setItem(trialKey, "used");
    setTrialStatus("available");
  }, [sessionLoading, sessionError, user, owner]);

  const verdict = state.landing
    ? landingVerdict(
        state.landing.x,
        state.landing.y,
        state.mode,
        state.serveCheck,
        state.nearSide,
        state.score[state.server],
      )
    : null;

  // Rally timer tick
  useEffect(() => {
    if (!state.rallyStartedAt) {
      setRallyElapsed(0);
      return;
    }
    const id = window.setInterval(() => {
      setRallyElapsed(Date.now() - state.rallyStartedAt!);
    }, 100);
    return () => window.clearInterval(id);
  }, [state.rallyStartedAt]);

  // Voice commands
  useEffect(() => {
    if (!voiceOn) return;
    if (!voiceSupported()) return;
    const controller = createVoiceController(() => [teamName(0), teamName(1)]);
    controller.setListener((cmd) => {
      if (owner && !editor.current) return;
      setVoiceHeard(null);
      if (cmd.type === "point") addPoint(cmd.team);
      else if (cmd.type === "fault") addFault(cmd.team, "fault");
      else if (cmd.type === "undo") undo();
      else if (cmd.type === "reset") reset();
      else setVoiceHeard(cmd.heard);
    });
    controller.start();
    return () => controller.stop();
  }, [voiceOn, addPoint, addFault, undo, reset, teamName, owner]);

  useEffect(() => {
    if (owner && durable.readOnly) setReferee(false);
  }, [owner, durable.readOnly]);

  // Auto-enable voice from persisted pref on mount
  useEffect(() => {
    const p = getStoredPrefs();
    if (p.voice) setVoiceOn(true);
  }, []);

  // The dashboard's “usual match” action carries the last-used context into the live setup.
  useEffect(() => {
    if (owner && (!localReady || !localCanEdit || state.matchStartedAt || state.matchOver)) return;
    const lobbyKey =
      owner || signedInId
        ? `shuttleboard.match-lobby.v1:${owner ?? signedInId}`
        : "shuttleboard.match-lobby.v1";
    try {
      const lobbyRaw = window.localStorage.getItem(lobbyKey);
      const raw =
        lobbyRaw ?? (!owner ? window.localStorage.getItem("shuttleboard.quick-match.v1") : null);
      if (!raw) return;
      const quick = JSON.parse(raw) as {
        mode?: "singles" | "doubles";
        preset?: string;
        names?: string[];
        title?: string;
        court?: string;
        teamA?: string;
        teamB?: string;
        colorA?: string;
        colorB?: string;
        warmup?: string;
      };
      if (owner) setLocalMeta({ title: quick.title, court: quick.court });
      else if (quick.title || quick.court)
        window.localStorage.setItem("shuttleboard.pending-match-meta.v1", JSON.stringify(quick));
      if (quick.warmup && quick.warmup !== "none") setWarmupRemaining(Number(quick.warmup) * 60);
      if (quick.mode) setMode(quick.mode);
      const preset = PRESETS.find((p) => p.id === quick.preset || p.label === quick.preset);
      if (preset) setPreset(preset.id as PresetId);
      if (quick.names?.[0] || quick.teamA) setName(0, quick.names?.[0] ?? quick.teamA ?? "You");
      if (quick.names?.[1] || quick.teamB)
        setName(1, quick.names?.[1] ?? quick.teamB ?? "Opponent");
      if (!owner) window.localStorage.removeItem("shuttleboard.quick-match.v1");
      window.localStorage.removeItem(lobbyKey);
      toast.success("Usual match loaded", {
        description: "Your last-used format and players are ready.",
      });
    } catch {
      window.localStorage.removeItem("shuttleboard.quick-match.v1");
    }
  }, [
    setMode,
    setName,
    setPreset,
    owner,
    signedInId,
    localReady,
    localCanEdit,
    setLocalMeta,
    state.matchStartedAt,
    state.matchOver,
  ]);

  useEffect(() => {
    if (warmupRemaining <= 0) return;
    const timer = window.setInterval(
      () => setWarmupRemaining((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [warmupRemaining]);

  // Referee mode fullscreen
  useEffect(() => {
    if (!referee) return;
    const el = containerRef.current;
    if (el && el.requestFullscreen) el.requestFullscreen().catch(() => {});
    const onExit = () => {
      if (!document.fullscreenElement) setReferee(false);
    };
    document.addEventListener("fullscreenchange", onExit);
    return () => {
      document.removeEventListener("fullscreenchange", onExit);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [referee]);

  // Auto-dismiss cinematic
  useEffect(() => {
    if (!state.celebrateAt) return;
    const t = window.setTimeout(dismissCelebration, state.celebrateKind === "match" ? 5000 : 2200);
    return () => window.clearTimeout(t);
  }, [state.celebrateAt, state.celebrateKind, dismissCelebration]);

  const exportCsv = async () => {
    const { downloadText, matchToCsv } = await import("@/lib/match-export");
    downloadText(`shuttleboard-${dateSlug()}.csv`, "text/csv", matchToCsv(state));
  };
  const exportPdf = () => window.print();
  const shareCard = async () => {
    const { downloadBlob, renderShareCard } = await import("@/lib/match-export");
    const blob = await renderShareCard(state);
    const file = new File([blob], `shuttleboard-${dateSlug()}.png`, { type: "image/png" });
    const nav = navigator as Navigator & {
      canShare?: (data: { files: File[] }) => boolean;
      share?: (data: { files: File[]; title?: string }) => Promise<void>;
    };
    if (nav.canShare && nav.canShare({ files: [file] })) {
      try {
        await nav.share!({ files: [file], title: "ShuttleBoard match" });
        return;
      } catch {
        /* fall through */
      }
    }
    downloadBlob(file.name, blob);
  };

  const historyKey = `${state.matchStartedAt ?? 0}:${state.completedGames.length}:${state.games.join("-")}`;
  const saveCompletedMatch = async () => {
    if (owner) {
      durable.retrySave();
      await durable.sync();
      return;
    }
    if (!user || !state.matchOver || savedHistoryKey === historyKey || savingHistory) return;
    setSavingHistory(true);
    try {
      const teamANames =
        state.mode === "doubles"
          ? state.doublesNames.slice(0, 2).map((name) => name.trim() || "Player")
          : [teamName(0)];
      const teamBNames =
        state.mode === "doubles"
          ? state.doublesNames.slice(2, 4).map((name) => name.trim() || "Player")
          : [teamName(1)];
      let lobby: { title?: string; court?: string } = {};
      try {
        lobby = JSON.parse(
          window.localStorage.getItem("shuttleboard.pending-match-meta.v1") ?? "{}",
        );
      } catch {
        /* ignore malformed optional metadata */
      }
      const saved = await saveMatch({
        data: {
          mode: state.mode,
          category: state.mode === "doubles" ? "mens-doubles" : "mens-singles",
          title: lobby.title || undefined,
          court_name: lobby.court || undefined,
          format: state.preset.label,
          points_to_win: state.preset.target,
          best_of: state.preset.bestOf,
          team_a_names: teamANames,
          team_b_names: teamBNames,
          team_a_handles: [],
          team_b_handles: [],
          games: state.completedGames,
          winner: state.matchWinnerTeam === null ? null : state.matchWinnerTeam === 0 ? "A" : "B",
          duration_seconds: state.matchStartedAt
            ? Math.max(0, Math.round((Date.now() - state.matchStartedAt) / 1000))
            : 0,
          longest_rally_seconds: Math.round(state.longestRallyMs / 1000),
          // Rally scoring: every point played is one rally, timed or not.
          total_rallies: totalMatchPoints(state),
          notes: "Saved from the live ShuttleBoard scoreboard.",
          tags: ["scoreboard"],
          opponent_nicknames: {},
          status: "finished",
        },
      });
      setSavedHistoryKey(historyKey);
      setSavedMatchId(saved.id);
      window.localStorage.setItem("shuttleboard.saved-history-key.v1", historyKey);
      window.localStorage.removeItem("shuttleboard.pending-match-meta.v1");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MATCHES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: PROGRESS_QUERY_KEY }),
        invalidateDashboard(queryClient),
      ]);
      toast.success("Match saved to History");
      if (saved.progressPending)
        toast.warning(
          "Your match is safe. Progress couldn't sync yet — open Progress and choose Sync saved progress.",
        );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Match could not be saved");
    } finally {
      setSavingHistory(false);
    }
  };

  useEffect(() => {
    if (owner || !user || !state.matchOver || savedHistoryKey === historyKey || savingHistory)
      return;
    void saveCompletedMatch();
    // The history key changes only when a new completed match is created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, state.matchOver, historyKey]);

  // Keep these returns after every hook so the scoreboard never changes its
  // hook order when the session or one-time preview status resolves.
  const offlinePanel = (
    <OfflineScoreboardPanel owner={owner} signedIn={Boolean(user)} session={durable} />
  );
  if (owner && !durable.ready)
    return (
      <>
        {offlinePanel}
        {!durable.legacy && !durable.error && <ScoreboardLoading />}
      </>
    );
  if (!owner && (sessionLoading || sessionError || trialStatus === "checking"))
    return <ScoreboardLoading />;
  if (!owner && !user && trialStatus === "used") return <TrialGate />;

  if (referee) {
    return (
      <div
        ref={containerRef}
        inert={Boolean(owner && !durable.canEdit)}
        className="fixed inset-0 z-[100] bg-background text-foreground"
      >
        <RefereeMode
          state={state}
          teamName={teamName}
          rallyElapsed={rallyElapsed}
          onPoint={addPoint}
          onUndo={undo}
          onExit={() => setReferee(false)}
          pointCalls={pointCalls}
        />
        <Cinematic state={state} onDone={dismissCelebration} />
      </div>
    );
  }

  return (
    <>
      {offlinePanel}
      <div
        ref={containerRef}
        inert={Boolean(owner && !durable.canEdit)}
        className="club-scoreboard space-y-6"
      >
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
              Courtside Control
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Scoreboard
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-semibold text-primary">
                {state.preset.label}
              </span>
              <span>
                Games <strong className="text-foreground">{state.games[0]}</strong>–
                <strong className="text-foreground">{state.games[1]}</strong>
              </span>
              {state.matchOver && state.matchWinnerTeam !== null && (
                <span className="rounded-full border border-primary/40 bg-primary/15 px-2.5 py-1 font-semibold text-primary">
                  🏆 {teamName(state.matchWinnerTeam)} wins the match
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setVoiceOn((v) => !v)}
              disabled={!voiceSupported()}
              title={
                voiceSupported() ? "Toggle voice commands" : "Voice not supported in this browser"
              }
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-medium transition-colors backdrop-blur disabled:opacity-40 ${
                voiceOn
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-white/10 bg-card/60 text-foreground hover:bg-card"
              }`}
            >
              {voiceOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
              Voice
            </button>
            <button
              onClick={() => setReferee(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-card/60 px-3.5 py-2 text-xs font-medium text-foreground hover:bg-card"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Referee mode
            </button>
            <button
              onClick={undo}
              disabled={!canUndo || Boolean(owner && state.matchOver)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-card/60 px-3.5 py-2 text-xs font-medium text-foreground hover:bg-card disabled:opacity-30"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Undo
            </button>
            <button
              onClick={reset}
              disabled={Boolean(owner && state.matchOver && !match.deviceSaved)}
              className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-3.5 py-2 text-xs font-medium text-destructive hover:bg-destructive/20"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {state.matchOver ? "New match" : "Reset"}
            </button>
          </div>
        </div>

        {voiceOn && (
          <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            Listening. Try: "point {teamName(0)}", "fault B", "undo".
            {voiceHeard && <span className="ml-auto opacity-70">Heard: "{voiceHeard}"</span>}
          </div>
        )}

        {warmupRemaining > 0 && (
          <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary shadow-[var(--shadow-glow)]">
            <span>
              <Timer className="mr-2 inline h-4 w-4" />
              Warm-up timer · loosen up before the first rally.
            </span>
            <strong className="font-display text-xl tabular-nums">
              {Math.floor(warmupRemaining / 60)}:{String(warmupRemaining % 60).padStart(2, "0")}
            </strong>
          </div>
        )}

        {/* Preset selector */}
        <div className="bento-tile p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Quick-start preset
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  disabled={Boolean(owner && state.matchOver && !match.deviceSaved)}
                  onClick={() => setPreset(p.id as PresetId)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    state.preset.id === p.id
                      ? "bg-primary text-primary-foreground shadow-[var(--shadow-glow)]"
                      : "border border-white/10 bg-card/40 text-foreground hover:bg-card"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Bento grid */}
        <div className="club-score-grid grid gap-4">
          <TeamCard
            className="club-team-card"
            onPoint={() => addPoint(0)}
            disabled={state.matchOver}
            active={state.server === 0}
            name={state.names[0]}
            onNameChange={(name) => setName(0, name)}
            score={state.score[0]}
            games={state.games[0]}
            label="Team A"
            pointCall={pointCalls[0]}
            isMatchWinner={state.matchWinnerTeam === 0}
          />
          <TeamCard
            className="club-team-card"
            onPoint={() => addPoint(1)}
            disabled={state.matchOver}
            active={state.server === 1}
            name={state.names[1]}
            onNameChange={(name) => setName(1, name)}
            score={state.score[1]}
            games={state.games[1]}
            label="Team B"
            pointCall={pointCalls[1]}
            isMatchWinner={state.matchWinnerTeam === 1}
          />

          {/* Court */}
          <section className="club-scoring-court bento-tile lg:col-span-2 lg:row-span-3">
            <div className="flex items-start justify-between gap-3 border-b border-white/5 px-4 py-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
                  Line Judge
                </p>
                <h2 className="mt-0.5 font-display text-sm font-semibold">
                  Tap where the shuttle landed
                </h2>
              </div>
              <div className="flex flex-col gap-1.5 text-[11px]">
                <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-white/10 bg-black/20 px-2 py-1">
                  <input
                    type="checkbox"
                    checked={state.serveCheck}
                    onChange={(e) => setServeCheck(e.target.checked)}
                    className="h-3 w-3 accent-primary"
                  />
                  Serve
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-white/10 bg-black/20 px-2 py-1">
                  <input
                    type="checkbox"
                    checked={state.nearSide}
                    onChange={(e) => setNearSide(e.target.checked)}
                    className="h-3 w-3 accent-primary"
                    title="Follows the serve and the change of ends; untick to swap ends"
                  />
                  Server near
                </label>
              </div>
            </div>
            <div className="p-3">
              <Court
                mode={state.mode}
                onTap={markLanding}
                landing={state.landing}
                isIn={verdict?.isIn ?? null}
              />
            </div>
            <div
              className={`mx-3 mb-3 rounded-xl border p-3 transition-colors ${
                verdict
                  ? verdict.isIn
                    ? "border-in/40 bg-in/10 text-in"
                    : "border-out/40 bg-out/10 text-out"
                  : "border-white/10 bg-black/20"
              }`}
            >
              <div className="flex items-center gap-2">
                {verdict ? (
                  verdict.isIn ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0" />
                  )
                ) : (
                  <Trophy className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <strong className="font-display text-base">
                  {verdict ? (verdict.isIn ? "In" : "Out") : "Awaiting landing mark"}
                </strong>
              </div>
              <p className="mt-1 text-xs opacity-80">
                {verdict
                  ? verdict.modeText
                  : "Full court for rallies. Diagonal service box for serves."}
              </p>
              {verdict?.closeLine && (
                <p className="mt-1.5 text-[11px] font-medium">
                  Close line — {verdict.lineMarginCm} cm from {verdict.nearestLine}.
                </p>
              )}
            </div>
          </section>

          {/* Meta strip */}
          <div className="bento-tile lg:col-span-4">
            <div className="grid grid-cols-4 divide-x divide-white/5">
              <MetaCell label="Server" value={teamName(state.server)} highlight />
              <MetaCell label="Correct Side" value={correctSide} capitalize />
              <MetaCell
                label="Next Rally Wins"
                value={matchPoint ? "Match" : gamePoint ? "Game" : "—"}
                tone={matchPoint || gamePoint ? "hot" : "muted"}
              />
              <RallyMeta
                rallyMs={rallyElapsed}
                longestMs={state.longestRallyMs}
                onStart={startRally}
                live={!!state.rallyStartedAt}
              />
            </div>
            {sideWarning && (
              <div className="flex items-center gap-2 border-t border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                Server should be on the <strong className="capitalize">{correctSide}</strong> side.
              </div>
            )}
            {doublesRotation && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/5 px-4 py-2 text-xs">
                <span className="text-muted-foreground">Rotation:</span>
                <span>
                  <strong className="text-primary">{doublesRotation.server}</strong> serves from{" "}
                  <span className="capitalize">{doublesRotation.side}</span>
                </span>
                <span className="text-muted-foreground">·</span>
                <span>
                  Partner: <strong>{doublesRotation.partner}</strong>
                </span>
                <span className="text-muted-foreground">·</span>
                <span>
                  Receiving: <strong>{doublesRotation.receiver}</strong>
                </span>
              </div>
            )}
          </div>

          {/* Controls */}
          <section className="bento-tile lg:col-span-4">
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <fieldset className="space-y-2">
                <legend className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Game Type
                </legend>
                <SegmentedGroup>
                  <ToggleButton
                    selected={state.mode === "singles"}
                    onClick={() => setMode("singles")}
                  >
                    Singles
                  </ToggleButton>
                  <ToggleButton
                    selected={state.mode === "doubles"}
                    onClick={() => setMode("doubles")}
                  >
                    Doubles
                  </ToggleButton>
                </SegmentedGroup>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  First Serve
                </legend>
                <SegmentedGroup>
                  {([0, 1] as const).map((team) => (
                    <ToggleButton
                      key={team}
                      selected={state.server === team}
                      disabled={matchHasStarted(state)}
                      onClick={() => setFirstServer(team)}
                    >
                      {teamName(team)}
                    </ToggleButton>
                  ))}
                </SegmentedGroup>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Serving From
                </legend>
                <SegmentedGroup>
                  <ToggleButton
                    selected={state.declaredSide === "right"}
                    onClick={() => setDeclaredSide("right")}
                  >
                    Right
                  </ToggleButton>
                  <ToggleButton
                    selected={state.declaredSide === "left"}
                    onClick={() => setDeclaredSide("left")}
                  >
                    Left
                  </ToggleButton>
                </SegmentedGroup>
              </fieldset>

              {state.mode === "doubles" && (
                <fieldset className="space-y-2 sm:col-span-2">
                  <legend className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Doubles Line-up
                  </legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(["A1", "A2", "B1", "B2"] as const).map((label, i) => (
                      <label
                        key={label}
                        className="flex flex-col gap-1 rounded-lg border border-white/10 bg-card/40 px-2.5 py-1.5"
                      >
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                          {label}
                        </span>
                        <input
                          value={state.doublesNames[i]}
                          onChange={(e) => setDoublesName(i as 0 | 1 | 2 | 3, e.target.value)}
                          className="bg-transparent text-sm font-semibold outline-none"
                          maxLength={16}
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              <FaultControls teamName={teamName} onFault={addFault} />
            </div>
          </section>

          {/* Calls & history + export */}
          <section className="bento-tile lg:col-span-4">
            <div className="flex items-center justify-between gap-2 border-b border-white/5 px-4 py-3">
              <h2 className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Calls &amp; History
              </h2>
              <div className="flex items-center gap-1.5">
                {state.matchOver &&
                  (user || owner ? (
                    <button
                      type="button"
                      onClick={saveCompletedMatch}
                      disabled={
                        owner ? match.deviceSaved : savingHistory || savedHistoryKey === historyKey
                      }
                      className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary disabled:opacity-60"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {owner
                        ? savedMatchId
                          ? "Synced"
                          : match.deviceSaved
                            ? "Saved on device"
                            : "Saving on device…"
                        : savedHistoryKey === historyKey
                          ? "Saved automatically"
                          : savingHistory
                            ? "Saving…"
                            : "Save now"}
                    </button>
                  ) : (
                    <Link
                      to="/auth"
                      className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary"
                    >
                      <Save className="h-3.5 w-3.5" /> Sign in to save
                    </Link>
                  ))}
                <IconChip
                  onClick={shareCard}
                  icon={<Share2 className="h-3.5 w-3.5" />}
                  label="Share PNG"
                />
                {state.matchOver && savedMatchId && (
                  <IconChip
                    onClick={async () => {
                      try {
                        const invite = await createInvite({
                          data: { match_id: savedMatchId, team_side: "B" },
                        });
                        const link = `${window.location.origin}/invite/${invite.token}`;
                        await navigator.clipboard?.writeText(link);
                        toast.success("Match invite link copied");
                      } catch (err: any) {
                        toast.error(err.message ?? "Could not create invite");
                      }
                    }}
                    icon={<Users className="h-3.5 w-3.5" />}
                    label="Invite"
                  />
                )}
                <IconChip
                  onClick={exportCsv}
                  icon={<FileDown className="h-3.5 w-3.5" />}
                  label="CSV"
                />
                <IconChip
                  onClick={exportPdf}
                  icon={<FileDown className="h-3.5 w-3.5" />}
                  label="PDF"
                />
                <Users className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </div>
            <ol className="max-h-56 space-y-1 overflow-y-auto px-4 py-3 text-sm">
              {state.log.length === 0 ? (
                <li className="text-xs italic text-muted-foreground">
                  No calls yet. Start with a rally point or a court tap.
                </li>
              ) : (
                state.log.map((item, i) => (
                  <li
                    key={i}
                    className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
                      item.kind === "match"
                        ? "border-primary/40 bg-primary/10 font-semibold"
                        : item.kind === "game"
                          ? "border-primary/25 bg-primary/5"
                          : "border-white/5 bg-black/20"
                    }`}
                  >
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_8px_oklch(0.82_0.17_165/0.8)]" />
                    <span>{item.text}</span>
                  </li>
                ))
              )}
            </ol>
          </section>
        </div>

        <Cinematic state={state} onDone={dismissCelebration} />
      </div>
    </>
  );
}

function dateSlug() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
}

function MetaCell({
  label,
  value,
  capitalize,
  highlight,
  tone,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
  highlight?: boolean;
  tone?: "hot" | "muted";
}) {
  return (
    <div className="px-4 py-3 text-center">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </span>
      <strong
        className={`mt-1 block font-display text-base font-semibold ${capitalize ? "capitalize" : ""} ${highlight ? "gradient-text" : ""} ${tone === "hot" ? "text-primary animate-glow-pulse" : ""}`}
      >
        {value}
      </strong>
    </div>
  );
}

function RallyMeta({
  rallyMs,
  longestMs,
  onStart,
  live,
}: {
  rallyMs: number;
  longestMs: number;
  onStart: () => void;
  live: boolean;
}) {
  return (
    <div className="px-4 py-3 text-center">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        <Timer className="mr-1 inline h-3 w-3 -translate-y-px" />
        Rally
      </span>
      <div className="mt-1 flex items-center justify-center gap-1.5">
        <strong
          className={`font-display text-base font-semibold tabular-nums ${live ? "text-primary" : "text-foreground"}`}
        >
          {(rallyMs / 1000).toFixed(1)}s
        </strong>
        {!live && (
          <button
            onClick={onStart}
            className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
            title="Start rally timer"
          >
            <Play className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
      <span className="mt-0.5 block text-[10px] text-muted-foreground">
        Longest {(longestMs / 1000).toFixed(1)}s
      </span>
    </div>
  );
}

function SegmentedGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex rounded-full border border-white/10 bg-black/25 p-0.5">
      {children}
    </div>
  );
}

function TeamCard({
  active,
  name,
  onNameChange,
  score,
  games,
  label,
  className = "",
  pointCall,
  isMatchWinner,
  onPoint,
  disabled,
}: {
  active: boolean;
  name: string;
  onNameChange: (name: string) => void;
  score: number;
  games: number;
  label: string;
  className?: string;
  pointCall?: PointCall;
  isMatchWinner?: boolean;
  onPoint: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className={`bento-tile p-5 ${active ? "tile-glow" : ""} ${isMatchWinner ? "animate-glow-pulse" : ""} ${className}`}
    >
      <div className="flex items-center justify-between">
        <label className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </label>
        <div className="flex items-center gap-1.5">
          {pointCall && !isMatchWinner && (
            <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary animate-glow-pulse">
              {pointCall === "match" ? "Match Point" : "Game Point"}
            </span>
          )}
          {active && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary shadow-[0_0_10px_oklch(0.82_0.17_165/0.9)]" />
              Serving
            </span>
          )}
        </div>
      </div>
      <input
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        maxLength={18}
        className="mt-1 w-full bg-transparent font-display text-lg font-semibold outline-none placeholder:text-muted-foreground"
        aria-label={`${label} name`}
      />
      <div className="flex items-end justify-between gap-3">
        <strong
          key={score}
          className={`score-num animate-score-pop mt-2 block text-6xl font-bold ${active ? "gradient-text-animated" : "text-foreground"}`}
        >
          {score}
        </strong>
        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Games
          </div>
          <div className="font-display text-2xl font-semibold text-foreground">{games}</div>
        </div>
      </div>
      <button
        className="club-point-button"
        disabled={disabled}
        onClick={onPoint}
        aria-label={`Point to ${name}`}
      >
        + Point
      </button>
    </div>
  );
}

function ToggleButton({
  selected,
  onClick,
  children,
  disabled = false,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${selected ? "bg-primary text-primary-foreground shadow-[var(--shadow-glow)]" : "text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

function IconChip({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-card/60 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground transition hover:border-primary/30 hover:text-foreground"
    >
      {icon}
      {label}
    </button>
  );
}

function FaultControls({
  teamName,
  onFault,
}: {
  teamName: (i: 0 | 1) => string;
  onFault: (team: 0 | 1, type: string) => void;
}) {
  const [team, setTeam] = useState<0 | 1>(0);
  const faults = ["service fault", "out of bounds", "net contact", "double hit", "carry"];
  return (
    <fieldset className="space-y-2 sm:col-span-2">
      <legend className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Award Fault Against
      </legend>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedGroup>
          <ToggleButton selected={team === 0} onClick={() => setTeam(0)}>
            {teamName(0)}
          </ToggleButton>
          <ToggleButton selected={team === 1} onClick={() => setTeam(1)}>
            {teamName(1)}
          </ToggleButton>
        </SegmentedGroup>
        <div className="flex flex-wrap gap-1.5">
          {faults.map((f) => (
            <button
              key={f}
              onClick={() => onFault(team, f)}
              className="rounded-full border border-white/10 bg-card/40 px-2.5 py-1 text-[11px] text-foreground transition hover:border-destructive/40 hover:text-destructive"
            >
              {f}
            </button>
          ))}
        </div>
      </div>
    </fieldset>
  );
}

/** Full-screen scoreboard for tablets sitting court-side. */
function ScoreboardLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="rounded-2xl border border-white/10 bg-card/70 px-5 py-4 text-sm text-muted-foreground shadow-[var(--shadow-tile)]">
        Preparing your court…
      </div>
    </div>
  );
}

function TrialGate() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center">
      <section className="bento-tile w-full p-7 text-center sm:p-10">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-[var(--shadow-glow)]">
          <LockKeyhole className="h-7 w-7" />
        </div>
        <p className="eyebrow mt-6 justify-center">Preview complete</p>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">
          Your free scoreboard trial is finished.
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          Create a ShuttleBoard account to keep scoring matches, save results to History, unlock AI
          analysis, and build your player profile.
        </p>
        <Link
          to="/auth"
          className="btn-primary-glow mt-7 inline-flex items-center gap-2 rounded-xl px-5 py-3.5 text-sm font-semibold"
        >
          Create your account <ArrowRight className="h-4 w-4" />
        </Link>
        <p className="mt-4 text-[11px] text-muted-foreground">
          Already have an account?{" "}
          <Link to="/auth" className="text-primary hover:underline">
            Log in
          </Link>
        </p>
      </section>
    </div>
  );
}

function RefereeMode({
  state,
  teamName,
  rallyElapsed,
  onPoint,
  onUndo,
  onExit,
  pointCalls,
}: {
  state: ReturnType<typeof useSharedBadmintonMatch>["state"];
  teamName: (i: 0 | 1) => string;
  rallyElapsed: number;
  onPoint: (t: 0 | 1) => void;
  onUndo: () => void;
  onExit: () => void;
  pointCalls: [PointCall, PointCall];
}) {
  return (
    <div className="flex h-dvh flex-col p-6">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">
          Referee Mode · {state.preset.label}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onUndo}
            className="rounded-full border border-white/10 bg-card/60 px-4 py-2 text-xs font-medium"
          >
            <Undo2 className="mr-1 inline h-3.5 w-3.5" />
            Undo
          </button>
          <button
            onClick={onExit}
            className="rounded-full border border-white/10 bg-card/60 px-4 py-2 text-xs font-medium"
          >
            <Minimize2 className="mr-1 inline h-3.5 w-3.5" />
            Exit
          </button>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-2 gap-6 py-6">
        {[0, 1].map((i) => {
          const idx = i as 0 | 1;
          const active = state.server === idx;
          return (
            <button
              key={idx}
              onClick={() => onPoint(idx)}
              className={`group flex flex-col items-center justify-center rounded-3xl border p-8 text-center transition-all ${
                active ? "border-primary/50 bg-primary/5 tile-glow" : "border-white/10 bg-card/40"
              }`}
            >
              <div className="text-lg font-semibold uppercase tracking-widest text-muted-foreground">
                {teamName(idx)}
              </div>
              <div
                key={state.score[idx]}
                className={`animate-score-pop mt-4 font-display text-[16vw] font-black leading-none tabular-nums ${active ? "gradient-text-animated" : ""}`}
              >
                {state.score[idx]}
              </div>
              <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  Games <strong className="text-foreground text-base">{state.games[idx]}</strong>
                </span>
                {pointCalls[idx] && (
                  <span className="rounded-full bg-primary/20 px-2 py-0.5 font-bold uppercase tracking-wider text-primary">
                    {pointCalls[idx] === "match" ? "Match Point" : "Game Point"}
                  </span>
                )}
              </div>
              <div className="mt-6 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                Tap anywhere to add point
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          <Timer className="mr-1 inline h-4 w-4" />
          Rally {(rallyElapsed / 1000).toFixed(1)}s · longest{" "}
          {(state.longestRallyMs / 1000).toFixed(1)}s
        </span>
        <span>
          Server: <strong className="text-foreground">{teamName(state.server)}</strong> ·{" "}
          <span className="capitalize">
            {state.score[state.server] % 2 === 0 ? "right" : "left"}
          </span>
        </span>
      </div>
    </div>
  );
}

function Cinematic({
  state,
  onDone,
}: {
  state: ReturnType<typeof useSharedBadmintonMatch>["state"];
  onDone: () => void;
}) {
  if (!state.celebrateAt || !state.celebrateKind) return null;
  const winner = state.matchWinnerTeam !== null ? state.names[state.matchWinnerTeam] : null;
  const kind = state.celebrateKind;
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-background/85 backdrop-blur-md animate-fade-up"
      onClick={onDone}
    >
      <div className="text-center">
        <div className="text-xs font-semibold uppercase tracking-[0.4em] text-primary">
          {kind === "match" ? "Match" : "Game"}
        </div>
        <div className="mt-2 animate-score-pop font-display text-6xl font-black gradient-text-animated sm:text-8xl">
          {kind === "match" ? "CHAMPION" : "GAME"}
        </div>
        {winner && kind === "match" && (
          <div className="mt-4 font-display text-2xl font-semibold">{winner}</div>
        )}
        <div className="mt-2 text-sm text-muted-foreground">
          {state.games[0]} — {state.games[1]} · {state.preset.label}
        </div>
        <div className="mt-6 text-xs text-muted-foreground">Tap anywhere to dismiss</div>
      </div>
    </div>
  );
}
