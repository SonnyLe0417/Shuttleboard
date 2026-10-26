import { type GameMode, type Side, correctServeSide, landingVerdict } from "@/lib/badminton";
import {
  type MatchRules,
  type PresetId,
  PRESETS,
  findPreset,
  gameWinner,
  isDecidingGame,
  matchWinner,
  midGamePoint,
} from "@/lib/badminton-rules";

export const DEFAULT_NAMES: [string, string] = ["Team A", "Team B"];
export const DEFAULT_DOUBLES: [string, string, string, string] = ["A1", "A2", "B1", "B2"];
export const MATCH_DRAFT_KEY = "shuttleboard.match-draft.v1";

export interface LogEntry {
  text: string;
  score: [number, number];
  at: number;
  kind: "point" | "fault" | "game" | "match" | "line" | "info";
}

export interface RallyRecord {
  ms: number;
  winner: 0 | 1;
  at: number;
}

export interface CompletedGame {
  a: number;
  b: number;
}

export interface MatchState {
  score: [number, number];
  games: [number, number];
  completedGames: CompletedGame[];
  server: 0 | 1;
  mode: GameMode;
  declaredSide: Side;
  serveCheck: boolean;
  /** The server is at the near end (bottom of the court diagram). Derived from nearTeam. */
  nearSide: boolean;
  /** Team at the near end. Ends change after each game and at 11 in the deciding game. */
  nearTeam: 0 | 1;
  /** Doubles: which partner (0 or 1) of each team stands in its right service court. */
  rightCourt: [0 | 1, 0 | 1];
  names: [string, string]; // team names (singles) or team-side labels (doubles)
  doublesNames: [string, string, string, string]; // A1, A2, B1, B2
  log: LogEntry[];
  landing: { x: number; y: number } | null;
  preset: MatchRules;
  matchStartedAt: number | null;
  rallyStartedAt: number | null;
  rallyHistory: RallyRecord[];
  longestRallyMs: number;
  matchOver: boolean;
  matchWinnerTeam: 0 | 1 | null;
  celebrateAt: number | null; // timestamp of latest cinematic event
  celebrateKind: "match" | "game" | null;
}

export interface Snapshot {
  score: [number, number];
  games: [number, number];
  completedGames: CompletedGame[];
  server: 0 | 1;
  mode: GameMode;
  declaredSide: Side;
  serveCheck: boolean;
  nearSide: boolean;
  nearTeam: 0 | 1;
  rightCourt: [0 | 1, 0 | 1];
  names: [string, string];
  doublesNames: [string, string, string, string];
  log: LogEntry[];
  rallyHistory: RallyRecord[];
  longestRallyMs: number;
  matchOver: boolean;
  matchWinnerTeam: 0 | 1 | null;
  preset: MatchRules;
  matchStartedAt: number | null;
  rallyStartedAt: number | null;
}

function snapshotOf(s: MatchState): Snapshot {
  return {
    score: [...s.score] as [number, number],
    games: [...s.games] as [number, number],
    completedGames: s.completedGames.map((game) => ({ ...game })),
    server: s.server,
    mode: s.mode,
    declaredSide: s.declaredSide,
    serveCheck: s.serveCheck,
    nearSide: s.nearSide,
    nearTeam: s.nearTeam,
    rightCourt: [...s.rightCourt] as [0 | 1, 0 | 1],
    names: [...s.names] as [string, string],
    doublesNames: [...s.doublesNames] as [string, string, string, string],
    log: [...s.log],
    rallyHistory: [...s.rallyHistory],
    longestRallyMs: s.longestRallyMs,
    matchOver: s.matchOver,
    matchWinnerTeam: s.matchWinnerTeam,
    preset: s.preset,
    matchStartedAt: s.matchStartedAt,
    rallyStartedAt: s.rallyStartedAt,
  };
}

export function initialState(preset: MatchRules): MatchState {
  return {
    score: [0, 0],
    games: [0, 0],
    completedGames: [],
    server: 0,
    mode: "singles",
    declaredSide: "right",
    serveCheck: false,
    nearSide: true,
    nearTeam: 0,
    rightCourt: [0, 0],
    names: [...DEFAULT_NAMES] as [string, string],
    doublesNames: [...DEFAULT_DOUBLES] as [string, string, string, string],
    log: [],
    landing: null,
    preset,
    matchStartedAt: null,
    rallyStartedAt: null,
    rallyHistory: [],
    longestRallyMs: 0,
    matchOver: false,
    matchWinnerTeam: null,
    celebrateAt: null,
    celebrateKind: null,
  };
}

export type MatchAction =
  | { type: "point"; team: 0 | 1; reason: string; at: number }
  | { type: "fault"; team: 0 | 1; fault: string; at: number }
  | { type: "undo" | "reset" | "dismiss" }
  | { type: "restore"; match: MatchState; history?: Snapshot[] }
  | { type: "name"; index: 0 | 1; name: string }
  | { type: "doublesName"; index: 0 | 1 | 2 | 3; name: string }
  | { type: "mode"; value: GameMode }
  | { type: "side"; value: Side }
  | { type: "serveCheck" | "nearSide"; value: boolean }
  | { type: "firstServer"; team: 0 | 1 }
  | { type: "preset"; id: PresetId; at: number }
  | { type: "rally"; at: number }
  | { type: "landing"; x: number; y: number; at: number }
  | { type: "ack"; sequence: number };
export type MatchEffect = { sequence: number; kind: "point" | "fault" | "game" | "match" };
export type MatchController = {
  match: MatchState;
  history: Snapshot[];
  effects: MatchEffect[];
  sequence: number;
};
/**
 * Which team was at the near end in a draft saved before ends were tracked.
 * Back then nearSide was a manual "the server is at the near end" flag.
 */
export function nearTeamOf(state: Partial<Pick<MatchState, "nearTeam" | "nearSide" | "server">>) {
  if (state.nearTeam === 0 || state.nearTeam === 1) return state.nearTeam;
  const server = state.server === 1 ? 1 : 0;
  return state.nearSide === false ? (server === 0 ? 1 : 0) : server;
}

/** Fills in what older drafts and undo snapshots lack, and re-reads the preset by id. */
export function withEnds<T extends Partial<MatchState>>(
  state: T,
): T & Pick<MatchState, "nearTeam" | "rightCourt"> {
  const rightCourt =
    Array.isArray(state.rightCourt) && state.rightCourt.length === 2
      ? state.rightCourt
      : ([0, 0] as [0 | 1, 0 | 1]);
  return {
    ...state,
    nearTeam: nearTeamOf(state),
    rightCourt,
    ...(state.preset ? { preset: findPreset(state.preset.id) } : {}),
  };
}

/**
 * BWF doubles: the server stands in the court named by their side's score.
 * Partners only swap courts when their side wins a rally it served, so who
 * that is depends on the rally history kept in rightCourt.
 */
export function doublesServe(
  state: Pick<MatchState, "server" | "score" | "rightCourt" | "doublesNames">,
) {
  const side = correctServeSide(state.score[state.server]);
  const inCourt = (team: 0 | 1) => {
    const players = state.doublesNames.slice(team * 2, team * 2 + 2);
    const right = state.rightCourt[team];
    return side === "right"
      ? { player: players[right], partner: players[1 - right] }
      : { player: players[1 - right], partner: players[right] };
  };
  const serving = inCourt(state.server);
  const receiving = inCourt(state.server === 0 ? 1 : 0);
  return {
    side,
    server: serving.player,
    partner: serving.partner,
    receiver: receiving.player,
    receiverPartner: receiving.partner,
  };
}

/** The first rally has begun, so the toss (who serves first) is settled. */
export function matchHasStarted(
  state: Pick<MatchState, "matchStartedAt" | "rallyStartedAt" | "completedGames" | "score">,
) {
  return (
    state.matchStartedAt !== null ||
    state.rallyStartedAt !== null ||
    state.completedGames.length > 0 ||
    state.score.some(Boolean)
  );
}

/** Points played so far. In rally scoring that is also the number of rallies. */
export function totalMatchPoints(
  state: Pick<MatchState, "completedGames" | "score" | "matchOver">,
) {
  const completed = state.completedGames.reduce((total, game) => total + game.a + game.b, 0);
  // The final game's score is retained on screen and already in completedGames.
  return completed + (state.matchOver ? 0 : state.score[0] + state.score[1]);
}
export function createMatchController(): MatchController {
  return { match: initialState(PRESETS[0]), history: [], effects: [], sequence: 0 };
}
function point(prev: MatchState, winner: 0 | 1, reason: string, now: number): MatchState {
  if (prev.matchOver) return prev;
  const rallyMs = prev.rallyStartedAt ? now - prev.rallyStartedAt : 0;
  const score: [number, number] = [prev.score[0], prev.score[1]];
  score[winner] += 1;

  const newRallies: RallyRecord[] =
    rallyMs > 0 ? [...prev.rallyHistory, { ms: rallyMs, winner, at: now }] : prev.rallyHistory;
  const newLongest = Math.max(prev.longestRallyMs, rallyMs);
  const winnerName = prev.names[winner].trim() || (winner === 0 ? "Team A" : "Team B");
  const nextLog: LogEntry[] = [
    {
      text: `${winnerName} ${reason}. Score ${score[0]}–${score[1]}${
        rallyMs > 0 ? ` · rally ${(rallyMs / 1000).toFixed(1)}s` : ""
      }.`,
      score,
      at: now,
      kind: "point",
    },
    ...prev.log,
  ];

  let games: [number, number] = [...prev.games] as [number, number];
  let completedGames = prev.completedGames;
  let matchOver: boolean = prev.matchOver;
  let matchWinnerTeam: 0 | 1 | null = prev.matchWinnerTeam;
  let celebrateAt: number | null = prev.celebrateAt;
  let celebrateKind: "match" | "game" | null = prev.celebrateKind;

  let newScore = score;
  let nearTeam = prev.nearTeam;
  let rightCourt: [0 | 1, 0 | 1] = [prev.rightCourt[0], prev.rightCourt[1]];
  // Doubles: a side that wins a rally while serving swaps its partners' courts.
  if (winner === prev.server) rightCourt[winner] = rightCourt[winner] === 0 ? 1 : 0;
  const gameNumber = prev.games[0] + prev.games[1] + 1;
  const mid = midGamePoint(prev.preset);
  const reachedMid = Math.max(...prev.score) < mid && Math.max(...score) >= mid;

  const gw = gameWinner(score, prev.preset);
  if (gw !== null) {
    games = [prev.games[0], prev.games[1]];
    games[gw] += 1;
    completedGames = [...prev.completedGames, { a: score[0], b: score[1] }];
    nextLog.unshift({
      text: `${winnerName} wins game ${prev.games[0] + prev.games[1] + 1}: ${score[0]}–${score[1]}.`,
      score,
      at: now,
      kind: "game",
    });
    const mw = matchWinner(games, prev.preset);
    if (mw !== null) {
      matchOver = true;
      matchWinnerTeam = mw;
      nextLog.unshift({
        text: `🏆 ${winnerName} wins the match ${games[0]}–${games[1]}!`,
        score,
        at: now,
        kind: "match",
      });
      celebrateAt = now;
      celebrateKind = "match";
    } else {
      celebrateAt = now;
      celebrateKind = "game";
      newScore = [0, 0];
      nearTeam = nearTeam === 0 ? 1 : 0;
      rightCourt = [0, 0];
      nextLog.unshift({
        text: `Change ends for game ${gameNumber + 1}. ${winnerName} serves first.`,
        score,
        at: now,
        kind: "info",
      });
    }
  } else if (reachedMid) {
    const changeEnds = isDecidingGame(gameNumber, prev.preset);
    if (changeEnds) nearTeam = nearTeam === 0 ? 1 : 0;
    nextLog.unshift({
      text: `Interval at ${mid}.${changeEnds ? " Change ends for the rest of the deciding game." : ""}`,
      score,
      at: now,
      kind: "info",
    });
  }

  return {
    ...prev,
    score: newScore,
    server: winner,
    nearTeam,
    nearSide: winner === nearTeam,
    rightCourt,
    declaredSide: correctServeSide(newScore[winner]),
    landing: null,
    games,
    completedGames,
    log: nextLog,
    rallyStartedAt: null,
    rallyHistory: newRallies,
    longestRallyMs: newLongest,
    matchOver,
    matchWinnerTeam,
    celebrateAt,
    celebrateKind,
    matchStartedAt: prev.matchStartedAt ?? prev.rallyStartedAt ?? now,
  };
}
export function reduceMatch(controller: MatchController, action: MatchAction): MatchController {
  const prev = controller.match;
  let next = prev,
    remember = false;
  switch (action.type) {
    case "ack":
      return {
        ...controller,
        effects: controller.effects.filter((effect) => effect.sequence > action.sequence),
      };
    case "restore":
      // Drafts saved by earlier versions (in IndexedDB or localStorage) lack newer fields.
      return {
        ...controller,
        match: withEnds(action.match),
        history: (action.history ?? []).slice(-60).map(withEnds),
        effects: [],
      };
    case "undo": {
      const snapshot = controller.history.at(-1);
      if (!snapshot) return controller;
      return {
        ...controller,
        match: { ...prev, ...snapshot, landing: null, celebrateAt: null, celebrateKind: null },
        history: controller.history.slice(0, -1),
      };
    }
    case "point":
    case "fault": {
      if (prev.matchOver) return controller;
      const winner = action.type === "point" ? action.team : action.team === 0 ? 1 : 0;
      const reason =
        action.type === "point"
          ? action.reason
          : `gets the point after ${prev.names[action.team].trim() || (action.team === 0 ? "Team A" : "Team B")} committed a ${action.fault}`;
      next = point(prev, winner, reason, action.at);
      const kinds: MatchEffect["kind"][] = [];
      if (action.type === "fault") kinds.push("fault");
      kinds.push(
        next.matchOver
          ? "match"
          : next.completedGames.length > prev.completedGames.length
            ? "game"
            : "point",
      );
      const effects = kinds.map((kind, index) => ({
        kind,
        sequence: controller.sequence + index + 1,
      }));
      return {
        ...controller,
        match: next,
        history: [...controller.history, snapshotOf(prev)].slice(-60),
        sequence: controller.sequence + effects.length,
        effects: [...controller.effects, ...effects],
      };
    }
    case "reset":
      next = initialState(findPreset(prev.preset.id));
      remember = true;
      break;
    case "name": {
      const names: [string, string] = [...prev.names];
      names[action.index] = action.name;
      next = { ...prev, names };
      break;
    }
    case "doublesName": {
      const names: [string, string, string, string] = [...prev.doublesNames];
      names[action.index] = action.name;
      next = { ...prev, doublesNames: names };
      break;
    }
    case "mode":
      next = { ...prev, mode: action.value };
      remember = true;
      break;
    case "side":
      next = { ...prev, declaredSide: action.value };
      remember = true;
      break;
    case "serveCheck":
      next = { ...prev, serveCheck: action.value };
      remember = true;
      break;
    case "nearSide": {
      // A correction of which end the server is at, i.e. a swap of ends.
      const server = prev.server;
      next = {
        ...prev,
        nearSide: action.value,
        nearTeam: action.value ? server : server === 0 ? 1 : 0,
      };
      remember = true;
      break;
    }
    case "firstServer": {
      if (matchHasStarted(prev) || prev.server === action.team) return controller;
      next = {
        ...prev,
        server: action.team,
        nearSide: action.team === prev.nearTeam,
        declaredSide: "right",
      };
      remember = true;
      break;
    }
    case "preset": {
      const preset = findPreset(action.id);
      // A new match keeps the names and settings but none of the old match's state.
      // Before the first rally the toss (first server and ends) also stands.
      const fresh = initialState(preset);
      const keepToss = !matchHasStarted(prev);
      const server = keepToss ? prev.server : fresh.server;
      const nearTeam = keepToss ? prev.nearTeam : fresh.nearTeam;
      next = {
        ...prev,
        preset,
        score: fresh.score,
        games: fresh.games,
        completedGames: [],
        server,
        nearSide: server === nearTeam,
        nearTeam,
        rightCourt: fresh.rightCourt,
        declaredSide: fresh.declaredSide,
        landing: null,
        matchOver: false,
        matchWinnerTeam: null,
        rallyHistory: [],
        longestRallyMs: 0,
        matchStartedAt: null,
        rallyStartedAt: null,
        celebrateAt: null,
        celebrateKind: null,
        log: [{ text: `New match — ${preset.label}.`, score: [0, 0], at: action.at, kind: "info" }],
      };
      remember = true;
      break;
    }
    case "rally":
      next = prev.rallyStartedAt || prev.matchOver ? prev : { ...prev, rallyStartedAt: action.at };
      break;
    case "dismiss":
      next = { ...prev, celebrateAt: null, celebrateKind: null };
      break;
    case "landing": {
      const verdict = landingVerdict(
        action.x,
        action.y,
        prev.mode,
        prev.serveCheck,
        prev.nearSide,
        prev.score[prev.server],
      );
      next = {
        ...prev,
        landing: { x: action.x, y: action.y },
        log: [
          {
            text: `${verdict.isIn ? "In" : "Out"} at ${Math.round(action.x * 100)}%, ${Math.round(action.y * 100)}% — ${verdict.modeText}`,
            score: [...prev.score],
            at: action.at,
            kind: "line",
          },
          ...prev.log,
        ],
      };
      break;
    }
  }
  if (next === prev) return controller;
  return {
    ...controller,
    match: next,
    history: remember ? [...controller.history, snapshotOf(prev)].slice(-60) : controller.history,
  };
}
