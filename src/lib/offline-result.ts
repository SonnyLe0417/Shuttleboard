import type { MatchState } from "./match-controller";
import type { QueuedMatch } from "./offline-db";
import { z } from "zod";
import { initialState, nearTeamOf, totalMatchPoints } from "./match-controller";
import { findPreset } from "./badminton-rules";
const side = z.union([z.literal(0), z.literal(1)]),
  score = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);
const legacySchema = z.object({
  score,
  games: score,
  completedGames: z
    .array(z.object({ a: z.number().int().nonnegative(), b: z.number().int().nonnegative() }))
    .max(9),
  server: side,
  mode: z.enum(["singles", "doubles"]),
  declaredSide: z.enum(["left", "right"]),
  serveCheck: z.boolean(),
  nearSide: z.boolean(),
  nearTeam: side.optional(),
  rightCourt: z.tuple([side, side]).optional(),
  names: z.tuple([z.string().max(60), z.string().max(60)]),
  doublesNames: z.tuple([
    z.string().max(60),
    z.string().max(60),
    z.string().max(60),
    z.string().max(60),
  ]),
  log: z.array(
    z.object({
      text: z.string(),
      score,
      at: z.number().finite(),
      kind: z.enum(["point", "fault", "game", "match", "line", "info"]),
    }),
  ),
  rallyHistory: z.array(
    z.object({ ms: z.number().nonnegative(), winner: side, at: z.number().finite() }),
  ),
  longestRallyMs: z.number().nonnegative(),
  matchStartedAt: z.number().positive().nullable(),
  matchOver: z.boolean(),
  matchWinnerTeam: side.nullable(),
  preset: z.object({ id: z.enum(["21", "15", "11", "golden"]) }),
});
export function restoreLegacyOfflineDraft(raw: string): MatchState {
  const result = legacySchema.safeParse(JSON.parse(raw));
  if (!result.success)
    throw Error(
      "The previous draft cannot be safely restored. Download it before starting a separate match.",
    );
  const preset = findPreset(result.data.preset.id);
  return {
    ...initialState(preset),
    ...result.data,
    nearTeam: nearTeamOf(result.data),
    preset,
    celebrateAt: null,
    celebrateKind: null,
    rallyStartedAt: null,
  };
}
export function completedOfflineMatch(
  owner: string,
  id: string,
  state: MatchState,
  meta: { title?: string; court?: string } = {},
): QueuedMatch {
  if (!state.matchOver || state.matchWinnerTeam === null || !state.matchStartedAt)
    throw Error("The match is not complete.");
  const ended = state.log.find((row) => row.kind === "match")?.at;
  if (!ended) throw Error("The match end time is missing.");
  const names = (team: 0 | 1) =>
    state.mode === "doubles"
      ? state.doublesNames.slice(team * 2, team * 2 + 2).map((n) => n.trim() || "Player")
      : [state.names[team].trim() || `Team ${team === 0 ? "A" : "B"}`];
  return {
    id,
    owner,
    status: "pending",
    attempts: 0,
    nextAttempt: 0,
    payload: {
      client_match_id: id,
      expected_owner_id: owner,
      started_at: new Date(state.matchStartedAt).toISOString(),
      finished_at: new Date(ended).toISOString(),
      mode: state.mode,
      category: state.mode === "doubles" ? "mens-doubles" : "mens-singles",
      title: meta.title || undefined,
      court_name: meta.court || undefined,
      format: state.preset.label,
      points_to_win: state.preset.target,
      best_of: state.preset.bestOf,
      team_a_names: names(0),
      team_b_names: names(1),
      team_a_handles: [],
      team_b_handles: [],
      games: state.completedGames.map((g) => ({ ...g })),
      winner: state.matchWinnerTeam === 0 ? "A" : "B",
      duration_seconds: Math.max(0, Math.round((ended - state.matchStartedAt) / 1000)),
      longest_rally_seconds: Math.round(state.longestRallyMs / 1000),
      total_rallies: totalMatchPoints(state),
      notes: "Saved from the live ShuttleBoard scoreboard.",
      tags: ["scoreboard"],
      opponent_nicknames: {},
      status: "finished",
    },
  };
}
