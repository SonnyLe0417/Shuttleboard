import { useState } from "react";
import { Trophy } from "lucide-react";
import { PRESETS, type PresetId } from "@/lib/badminton-rules";
import type { PlayerId } from "@/lib/match-annotation";
import {
  formatSideChanges,
  parseSideChanges,
  type VideoMatch,
  type VideoMatchSettings,
} from "@/lib/video-match";

const playerName = (player: PlayerId) => (player === "p1" ? "Player 1" : "Player 2");
const other = (player: PlayerId): PlayerId => (player === "p1" ? "p2" : "p1");

export function VideoMatchPanel({
  match,
  settings,
  onSettingsChange,
}: {
  match: VideoMatch;
  settings: VideoMatchSettings;
  onSettingsChange: (settings: VideoMatchSettings) => void;
}) {
  const { timeline } = match;
  const [changesText, setChangesText] = useState(() => formatSideChanges(settings.sideChanges));
  const [changesError, setChangesError] = useState<string | null>(null);
  const won = (player: PlayerId) => timeline.gamesWon[player];
  const result = timeline.matchWinner
    ? `${playerName(timeline.matchWinner)} wins ${won(timeline.matchWinner)}–${won(other(timeline.matchWinner))}`
    : `Game ${timeline.game} in progress`;

  const applyChanges = (text: string, initialNear = settings.initialNear) => {
    const parsed = parseSideChanges(text, initialNear);
    if (!parsed) {
      setChangesError("Use times like 14:22, separated by commas.");
      return;
    }
    setChangesError(null);
    onSettingsChange({ ...settings, initialNear, sideChanges: parsed });
  };

  return (
    <section className="mt-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Match score
        </p>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
          <Trophy className="h-3.5 w-3.5" /> {result}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {(["p1", "p2"] as const).map((player) => (
          <div key={player} className="rounded-lg border border-border bg-background/40 p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {playerName(player)} · {match.near === player ? "near" : "far"} end
            </p>
            <p className="mt-1 text-4xl font-bold tabular-nums">{match.score[player]}</p>
            <p className="text-[11px] text-muted-foreground">Games {won(player)}</p>
          </div>
        ))}
      </div>
      {timeline.games.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {timeline.games.map((game, index) => (
            <span key={index} className="mr-2 rounded-md border border-border px-2 py-0.5">
              Game {index + 1}: {game.p1}–{game.p2}
            </span>
          ))}
        </p>
      )}
      {match.pending > 0 && (
        <p role="status" className="mt-2 text-[11px] text-amber-300">
          {match.pending === 1 ? "1 rally" : `${match.pending} rallies`} in this score{" "}
          {match.pending === 1 ? "is" : "are"} still a suggestion. Confirmed so far:{" "}
          {match.confirmed.map((game) => `${game.p1}–${game.p2}`).join(", ") || "none"}.
        </p>
      )}

      <div className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
        <label className="block">
          <span className="text-muted-foreground">Near end at the start</span>
          <select
            value={settings.initialNear}
            onChange={(event) => {
              const initialNear = event.target.value as PlayerId;
              if (settings.sideChanges.length) applyChanges(changesText, initialNear);
              else onSettingsChange({ ...settings, initialNear });
            }}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5"
          >
            <option value="p1">Player 1</option>
            <option value="p2">Player 2</option>
          </select>
        </label>
        <label className="block">
          <span className="text-muted-foreground">Scoring</span>
          <select
            value={settings.presetId}
            onChange={(event) =>
              onSettingsChange({ ...settings, presetId: event.target.value as PresetId })
            }
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5"
          >
            {PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-muted-foreground">Ends changed at (optional)</span>
          <input
            value={changesText}
            onChange={(event) => setChangesText(event.target.value)}
            onBlur={() => applyChanges(changesText)}
            placeholder="e.g. 14:22"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5"
          />
        </label>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {changesError ??
          (settings.sideChanges.length
            ? "Players are matched to ends from the times you marked."
            : "Without marked times, players change ends after each game and at the interval of the deciding game.")}
      </p>
    </section>
  );
}
