import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { matchResultProblem, rulesForResult } from "@/lib/badminton-rules";
import {
  listMyMatches,
  deleteMatch,
  headToHead,
  saveMatch,
  getMyPreferences,
  updateMatchExtras,
} from "@/lib/matches.functions";
import { saveMatchReflection, saveOpponentMemory } from "@/lib/progress.functions";
import {
  Loader2,
  Trash2,
  Trophy,
  Swords,
  Plus,
  Users,
  User as UserIcon,
  Tag,
  Pencil,
  X,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Share2 } from "lucide-react";
import { getMyProfile } from "@/lib/matches.functions";
import { renderProgressShareCard, renderHeadToHeadShareCard } from "@/lib/match-export";
import { invalidateDashboard, MATCHES_QUERY_KEY, PROGRESS_QUERY_KEY } from "@/lib/query-keys";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [
      { title: "Match history · ShuttleBoard" },
      { name: "description", content: "Your saved matches and head-to-head rivalries." },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const qc = useQueryClient();
  const fetchMatches = useServerFn(listMyMatches);
  const delFn = useServerFn(deleteMatch);
  const {
    data: matches,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["matches", "mine"],
    queryFn: () => fetchMatches(),
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Match deleted");
      qc.invalidateQueries({ queryKey: MATCHES_QUERY_KEY });
      qc.invalidateQueries({ queryKey: PROGRESS_QUERY_KEY });
      invalidateDashboard(qc);
    },
    onError: (e: any) => toast.error(e.message ?? "Delete failed"),
  });

  return (
    <div className="space-y-8">
      <header className="club-page-heading">
        <h1 className="font-display text-3xl font-bold">Match history</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Saved games, rivalries, and quick manual entry.
        </p>
      </header>

      {matches && matches.length > 0 && <PerformanceSnapshot matches={matches as any[]} />}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-2xl border border-white/10 bg-card/60 p-5 backdrop-blur">
          <div className="mb-4 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" />
            <h2 className="font-display text-lg font-semibold">Your matches</h2>
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : isError && !matches ? (
            <div role="alert">
              <p className="text-sm text-muted-foreground">
                Your match history couldn't load. Your saved matches haven't been removed.
              </p>
              <button className="button-secondary mt-3" onClick={() => void refetch()}>
                Try again
              </button>
            </div>
          ) : !matches || matches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No matches yet. Add your first result using the match form.
            </p>
          ) : (
            <ul className="space-y-2">
              {matches.map((m: any) => (
                <MatchRow key={m.id} match={m} onDelete={() => del.mutate(m.id)} />
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          <HeadToHeadCard />
          <LogMatchCard />
        </div>
      </div>
    </div>
  );
}

function PerformanceSnapshot({ matches }: { matches: any[] }) {
  const profileFn = useServerFn(getMyProfile);
  const { data: profile } = useQuery({ queryKey: ["me", "profile"], queryFn: () => profileFn() });
  const finished = matches.filter((m) => m.winner);
  const wins = finished.filter((m) => m.winner === "A").length;
  const singles = finished.filter((m) => m.mode === "singles");
  const doubles = finished.filter((m) => m.mode === "doubles");
  const scoreCounts = new Map<string, number>();
  let comebackWins = 0;
  for (const m of finished) {
    const games = (m.games ?? []) as { a: number; b: number }[];
    if (m.winner === "A" && games.some((g) => g.a < g.b)) comebackWins++;
    if (m.winner === "B") {
      for (const g of games)
        if (g.a < g.b)
          scoreCounts.set(`${g.a}-${g.b}`, (scoreCounts.get(`${g.a}-${g.b}`) ?? 0) + 1);
    }
  }
  const commonLoss = [...scoreCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  return (
    <section className="bento-tile p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">
            <Trophy className="h-3.5 w-3.5" /> Performance lab
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold">The numbers behind your game</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{finished.length} completed matches</span>
          <button
            type="button"
            onClick={async () => {
              const blob = await renderProgressShareCard({
                name: profile?.display_name ?? "Player",
                handle: profile?.handle,
                matches: finished.length,
                winRate: finished.length ? Math.round((wins / finished.length) * 100) : 0,
                streak: currentWinStreak(finished),
                level: "Match Player",
              });
              const file = new File([blob], "shuttleboard-progress.png", { type: "image/png" });
              const nav = navigator as Navigator & {
                canShare?: (data: { files: File[] }) => boolean;
                share?: (data: { files: File[]; title?: string }) => Promise<void>;
              };
              if (nav.canShare?.({ files: [file] }))
                await nav.share?.({ files: [file], title: "ShuttleBoard progress" });
              else {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = file.name;
                a.click();
                URL.revokeObjectURL(url);
              }
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-[11px] font-semibold text-primary"
          >
            <Share2 className="h-3 w-3" /> Share progress
          </button>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <SnapshotStat
          label="Win rate"
          value={`${finished.length ? Math.round((wins / finished.length) * 100) : 0}%`}
        />
        <SnapshotStat label="Singles" value={`${modeWins(singles)}%`} />
        <SnapshotStat label="Doubles" value={`${modeWins(doubles)}%`} />
        <SnapshotStat label="Comebacks" value={`${comebackWins}`} />
        <SnapshotStat label="Loss pattern" value={commonLoss} />
        <SnapshotStat label="Avg. margin" value={averageMargin(finished)} />
        <SnapshotStat label="Best of" value={bestOf(finished)} />
      </div>
    </section>
  );
  function modeWins(rows: any[]) {
    return rows.length
      ? Math.round((rows.filter((m) => m.winner === "A").length / rows.length) * 100)
      : 0;
  }
}

function currentWinStreak(rows: any[]) {
  let streak = 0;
  for (const row of rows) {
    if (row.winner === "A") streak++;
    else break;
  }
  return streak;
}

function SnapshotStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-background/35 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-display text-lg font-semibold text-foreground">
        {value}
      </div>
    </div>
  );
}

function averageMargin(matches: any[]) {
  const games = matches.flatMap((m) => (m.games ?? []) as { a: number; b: number }[]);
  return games.length
    ? (games.reduce((sum, g) => sum + Math.abs(g.a - g.b), 0) / games.length).toFixed(1)
    : "0.0";
}

function bestOf(matches: any[]) {
  const counts = new Map<number, number>();
  for (const m of matches) counts.set(m.best_of ?? 3, (counts.get(m.best_of ?? 3) ?? 0) + 1);
  return `${[...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 3} games`;
}

function MatchRow({ match, onDelete }: { match: any; onDelete: () => void }) {
  const qc = useQueryClient();
  const updateExtras = useServerFn(updateMatchExtras);
  const saveReflection = useServerFn(saveMatchReflection);
  const saveMemory = useServerFn(saveOpponentMemory);
  const [editing, setEditing] = useState(false);
  const [tags, setTags] = useState<string[]>(match.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [notes, setNotes] = useState<string>(match.notes ?? "");
  const [nickA, setNickA] = useState<string>(match.opponent_nicknames?.A ?? "");
  const [nickB, setNickB] = useState<string>(match.opponent_nicknames?.B ?? "");
  const [saving, setSaving] = useState(false);
  const [reflectionOpen, setReflectionOpen] = useState(false);
  const [reflection, setReflection] = useState({ went_well: "", difficult: "", next_focus: "" });
  const [reflectionSaving, setReflectionSaving] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memory, setMemory] = useState({
    worked: "",
    difficult: "",
    tendencies: "",
    next_plan: "",
  });
  const [memorySaving, setMemorySaving] = useState(false);

  const aNames = (match.team_a_names ?? []).join(" & ");
  const bNames = (match.team_b_names ?? []).join(" & ");
  const a = nickA || aNames;
  const b = nickB || bNames;
  const scores = (match.games as { a: number; b: number }[])
    .map((g) => `${g.a}-${g.b}`)
    .join(" · ");
  const wonA = match.winner === "A";

  async function save() {
    setSaving(true);
    try {
      await updateExtras({
        data: {
          id: match.id,
          tags,
          notes: notes || null,
          opponent_nicknames: { ...(nickA ? { A: nickA } : {}), ...(nickB ? { B: nickB } : {}) },
        },
      });
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: MATCHES_QUERY_KEY });
      invalidateDashboard(qc);
      setEditing(false);
    } catch (err: any) {
      toast.error(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveReflectionForm() {
    setReflectionSaving(true);
    try {
      await saveReflection({ data: { match_id: match.id, ...reflection } });
      toast.success("Reflection saved");
      qc.invalidateQueries({ queryKey: PROGRESS_QUERY_KEY });
      invalidateDashboard(qc);
      setReflectionOpen(false);
    } catch (err: any) {
      toast.error(err.message ?? "Reflection failed");
    } finally {
      setReflectionSaving(false);
    }
  }

  async function saveMemoryForm() {
    setMemorySaving(true);
    try {
      const opponentId = (match.team_b_user_ids?.[0] as string | undefined) ?? null;
      const opponentKey = opponentId ?? bNames.toLowerCase().trim().replace(/\s+/g, "-");
      await saveMemory({
        data: {
          opponent_id: opponentId,
          opponent_key: opponentKey,
          opponent_name: bNames || "Opponent",
          ...memory,
        },
      });
      toast.success("Opponent strategy saved privately");
      qc.invalidateQueries({ queryKey: PROGRESS_QUERY_KEY });
      invalidateDashboard(qc);
      setMemoryOpen(false);
    } catch (err: any) {
      toast.error(err.message ?? "Strategy note failed");
    } finally {
      setMemorySaving(false);
    }
  }

  function addTag() {
    const t = tagDraft.trim().slice(0, 30);
    if (!t || tags.includes(t) || tags.length >= 10) return;
    setTags([...tags, t]);
    setTagDraft("");
  }

  return (
    <li className="group rounded-xl border border-white/5 bg-background/40 px-4 py-3">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className={wonA ? "gradient-text-animated" : ""}>{a}</span>
            <span className="text-muted-foreground">vs</span>
            <span className={match.winner === "B" ? "gradient-text-animated" : ""}>{b}</span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {match.mode === "doubles" ? (
              <Users className="mr-1 inline h-3 w-3" />
            ) : (
              <UserIcon className="mr-1 inline h-3 w-3" />
            )}
            {match.format} · {scores}
            {match.winner ? ` · ${match.winner === "A" ? aNames : bNames} won` : " · unfinished"}
          </div>
          {tags.length > 0 && !editing && (
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary"
                >
                  <Tag className="h-2.5 w-2.5" />
                  {t}
                </span>
              ))}
            </div>
          )}
          {notes && !editing && (
            <p className="mt-1.5 line-clamp-2 text-[11px] italic text-muted-foreground">
              "{notes}"
            </p>
          )}
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-1">
          <button
            onClick={() => setReflectionOpen((value) => !value)}
            className="rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-primary/10 hover:text-primary group-hover:opacity-100"
            aria-label="Add match reflection"
            title="Add match reflection"
          >
            <Sparkles className="h-4 w-4" />
          </button>
          <button
            onClick={() => setMemoryOpen((value) => !value)}
            className="rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-primary/10 hover:text-primary group-hover:opacity-100"
            aria-label="Add private opponent strategy"
            title="Add private opponent strategy"
          >
            <Swords className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              window.localStorage.setItem(
                "shuttleboard.rematch.v1",
                JSON.stringify({
                  mode: match.mode,
                  title: match.title ? `Rematch · ${match.title}` : "Rematch",
                  court: match.court_name ?? "",
                  teamA: aNames,
                  teamB: bNames,
                }),
              );
              window.location.href = "/match-lobby";
            }}
            className="rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-primary/10 hover:text-primary group-hover:opacity-100"
            aria-label="Quick rematch"
            title="Quick rematch"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setEditing((e) => !e)}
            className="rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-primary/10 hover:text-primary group-hover:opacity-100"
            aria-label="Edit tags and notes"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={onDelete}
            className="rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            aria-label="Delete match"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={nickA}
              onChange={(e) => setNickA(e.target.value)}
              placeholder={`Nickname for ${aNames}`}
              className="rounded-lg border border-white/10 bg-background px-3 py-2 text-xs outline-none"
            />
            <input
              value={nickB}
              onChange={(e) => setNickB(e.target.value)}
              placeholder={`Nickname for ${bNames}`}
              className="rounded-lg border border-white/10 bg-background px-3 py-2 text-xs outline-none"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-background px-2 py-2">
            {tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary"
              >
                {t}
                <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))}>
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="add tag +"
              className="min-w-[80px] flex-1 bg-transparent px-1 py-0.5 text-xs outline-none"
            />
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 500))}
            rows={2}
            placeholder="Notes about this match…"
            className="w-full resize-none rounded-lg border border-white/10 bg-background px-3 py-2 text-xs outline-none"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      )}

      {reflectionOpen && (
        <div className="mt-3 space-y-2 border-t border-primary/20 pt-3">
          <p className="text-xs font-semibold text-primary">
            What will you carry into the next session?
          </p>
          <textarea
            value={reflection.went_well}
            onChange={(event) =>
              setReflection({ ...reflection, went_well: event.target.value.slice(0, 1000) })
            }
            rows={2}
            placeholder="What went well?"
            className="w-full resize-none rounded-lg border border-white/10 bg-background px-3 py-2 text-xs outline-none"
          />
          <textarea
            value={reflection.difficult}
            onChange={(event) =>
              setReflection({ ...reflection, difficult: event.target.value.slice(0, 1000) })
            }
            rows={2}
            placeholder="What felt difficult?"
            className="w-full resize-none rounded-lg border border-white/10 bg-background px-3 py-2 text-xs outline-none"
          />
          <textarea
            value={reflection.next_focus}
            onChange={(event) =>
              setReflection({ ...reflection, next_focus: event.target.value.slice(0, 1000) })
            }
            rows={2}
            placeholder="What is your next focus?"
            className="w-full resize-none rounded-lg border border-white/10 bg-background px-3 py-2 text-xs outline-none"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={saveReflectionForm}
              disabled={reflectionSaving}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {reflectionSaving ? "Saving…" : "Save reflection"}
            </button>
          </div>
        </div>
      )}

      {memoryOpen && (
        <div className="mt-3 space-y-2 border-t border-primary/20 pt-3">
          <p className="text-xs font-semibold text-primary">
            Private strategy memory for {bNames || "this opponent"}
          </p>
          <textarea
            value={memory.worked}
            onChange={(event) =>
              setMemory({ ...memory, worked: event.target.value.slice(0, 1000) })
            }
            rows={2}
            placeholder="What worked?"
            className="w-full resize-none rounded-lg border border-white/10 bg-background px-3 py-2 text-xs outline-none"
          />
          <textarea
            value={memory.difficult}
            onChange={(event) =>
              setMemory({ ...memory, difficult: event.target.value.slice(0, 1000) })
            }
            rows={2}
            placeholder="What was difficult?"
            className="w-full resize-none rounded-lg border border-white/10 bg-background px-3 py-2 text-xs outline-none"
          />
          <textarea
            value={memory.tendencies}
            onChange={(event) =>
              setMemory({ ...memory, tendencies: event.target.value.slice(0, 1000) })
            }
            rows={2}
            placeholder="What tendencies did you notice?"
            className="w-full resize-none rounded-lg border border-white/10 bg-background px-3 py-2 text-xs outline-none"
          />
          <textarea
            value={memory.next_plan}
            onChange={(event) =>
              setMemory({ ...memory, next_plan: event.target.value.slice(0, 1000) })
            }
            rows={2}
            placeholder="What is your next-match plan?"
            className="w-full resize-none rounded-lg border border-white/10 bg-background px-3 py-2 text-xs outline-none"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={saveMemoryForm}
              disabled={memorySaving}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {memorySaving ? "Saving…" : "Save private strategy"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function HeadToHeadCard() {
  const h2hFn = useServerFn(headToHead);
  const [opponent, setOpponent] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const r = await h2hFn({ data: { opponentHandle: opponent } });
      setResult(r);
    } catch (err: any) {
      toast.error(err.message ?? "Not found");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-card/60 p-5 backdrop-blur">
      <div className="mb-3 flex items-center gap-2">
        <Swords className="h-4 w-4 text-primary" />
        <h2 className="font-display text-lg font-semibold">Head-to-head</h2>
      </div>
      <form onSubmit={lookup} className="flex gap-2">
        <div className="flex flex-1 items-center rounded-lg border border-white/10 bg-background">
          <span className="pl-3 text-sm text-muted-foreground">@</span>
          <input
            value={opponent}
            onChange={(e) => setOpponent(e.target.value)}
            placeholder="opponent"
            className="w-full bg-transparent px-2 py-2 text-sm outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !opponent}
          className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
        </button>
      </form>
      {result && (
        <div className="mt-4 rounded-xl border border-white/5 bg-background/40 p-4">
          <div className="text-xs text-muted-foreground">
            vs {result.opponent.display_name} (@{result.opponent.handle})
          </div>
          <div className="mt-2 flex items-center justify-around text-center">
            <div>
              <div className="text-3xl font-bold gradient-text-animated">{result.wins_me}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">you</div>
            </div>
            <div className="text-muted-foreground">—</div>
            <div>
              <div className="text-3xl font-bold">{result.wins_them}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">them</div>
            </div>
          </div>
          <div className="mt-2 text-center text-[11px] text-muted-foreground">
            {result.matches_played} match{result.matches_played === 1 ? "" : "es"}
          </div>
          <button
            type="button"
            onClick={async () => {
              const blob = await renderHeadToHeadShareCard({
                me: "You",
                opponent: result.opponent.handle,
                matches: result.matches_played,
                winsMe: result.wins_me,
                winsThem: result.wins_them,
              });
              const file = new File([blob], "shuttleboard-head-to-head.png", { type: "image/png" });
              const nav = navigator as Navigator & {
                canShare?: (data: { files: File[] }) => boolean;
                share?: (data: { files: File[]; title?: string }) => Promise<void>;
              };
              if (nav.canShare?.({ files: [file] }))
                await nav.share?.({ files: [file], title: "ShuttleBoard head-to-head" });
              else {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = file.name;
                a.click();
                URL.revokeObjectURL(url);
              }
            }}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary"
          >
            <Share2 className="h-3.5 w-3.5" /> Share rivalry card
          </button>
        </div>
      )}
    </section>
  );
}

function LogMatchCard() {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveMatch);
  const fetchPrefs = useServerFn(getMyPreferences);
  const { data: prefs } = useQuery({
    queryKey: ["me", "preferences"],
    queryFn: () => fetchPrefs(),
  });
  const defaults = (prefs?.match_defaults ?? {}) as {
    mode?: "singles" | "doubles";
    format?: string;
    points_to_win?: number;
    best_of?: number;
    starting_a?: string;
    starting_b?: string;
  };
  const [aName, setAName] = useState("");
  const [bName, setBName] = useState("");
  const [bHandle, setBHandle] = useState("");
  const pointsDefault = defaults.points_to_win ?? 21;
  const [scoreA, setScoreA] = useState(pointsDefault);
  const [scoreB, setScoreB] = useState(0);
  const [saving, setSaving] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (defaults.starting_a && !aName) setAName(defaults.starting_a);
    if (defaults.starting_b && !bName) setBName(defaults.starting_b);
    if (defaults.points_to_win) setScoreA(defaults.points_to_win);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs]);

  function addTag() {
    const t = tagDraft.trim().slice(0, 30);
    if (!t || tags.includes(t) || tags.length >= 10) return;
    setTags([...tags, t]);
    setTagDraft("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const winner = scoreA === scoreB ? null : scoreA > scoreB ? "A" : "B";
      const format = defaults.format || "21-point";
      const pointsToWin = defaults.points_to_win ?? 21;
      const bestOf = defaults.best_of ?? 1;
      const problem = matchResultProblem(
        [{ a: scoreA, b: scoreB }],
        winner,
        rulesForResult(pointsToWin, bestOf, format),
        { bestOf, complete: false },
      );
      if (problem) throw new Error(`Check the score: ${problem}`);
      const saved = await saveFn({
        data: {
          mode: defaults.mode ?? "singles",
          format,
          points_to_win: pointsToWin,
          best_of: bestOf,
          team_a_names: [aName || defaults.starting_a || "You"],
          team_b_names: [bName || bHandle || defaults.starting_b || "Opponent"],
          team_a_handles: [],
          team_b_handles: bHandle ? [bHandle] : [],
          games: [{ a: scoreA, b: scoreB }],
          winner,
          duration_seconds: 0,
          longest_rally_seconds: 0,
          total_rallies: 0,
          notes: notes || undefined,
          tags,
          opponent_nicknames: {},
          status: "finished",
        },
      });
      toast.success("Match logged");
      if (saved.progressPending)
        toast.warning(
          "Your match is safe. Open Progress and choose Sync saved progress to retry rewards.",
        );
      qc.invalidateQueries({ queryKey: MATCHES_QUERY_KEY });
      qc.invalidateQueries({ queryKey: PROGRESS_QUERY_KEY });
      invalidateDashboard(qc);
      setAName(defaults.starting_a ?? "");
      setBName(defaults.starting_b ?? "");
      setBHandle("");
      setScoreA(defaults.points_to_win ?? 21);
      setScoreB(0);
      setTags([]);
      setNotes("");
    } catch (err: any) {
      toast.error(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-card/60 p-5 backdrop-blur">
      <div className="mb-3 flex items-center gap-2">
        <Plus className="h-4 w-4 text-primary" />
        <h2 className="font-display text-lg font-semibold">Log a match</h2>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <input
            value={aName}
            onChange={(e) => setAName(e.target.value)}
            placeholder="Your side"
            className="rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none"
          />
          <input
            value={bName}
            onChange={(e) => setBName(e.target.value)}
            placeholder="Opponent"
            className="rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none"
          />
        </div>
        <input
          value={bHandle}
          onChange={(e) => setBHandle(e.target.value.replace(/^@/, "").toLowerCase())}
          placeholder="opponent @handle (for head-to-head)"
          className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none"
        />
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] uppercase text-muted-foreground">Your score</span>
            <input
              type="number"
              min={0}
              max={40}
              value={scoreA}
              onChange={(e) => setScoreA(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase text-muted-foreground">Opp score</span>
            <input
              type="number"
              min={0}
              max={40}
              value={scoreB}
              onChange={(e) => setScoreB(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-background px-2 py-2">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary"
            >
              {t}
              <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))}>
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="tags (Enter to add) +"
            className="min-w-[80px] flex-1 bg-transparent px-1 py-0.5 text-xs outline-none"
          />
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 500))}
          rows={2}
          placeholder="Notes (optional)"
          className="w-full resize-none rounded-lg border border-white/10 bg-background px-3 py-2 text-xs outline-none"
        />
        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Save match"}
        </button>
      </form>
    </section>
  );
}
