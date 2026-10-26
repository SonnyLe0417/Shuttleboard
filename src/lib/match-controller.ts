import { type GameMode, type Side, landingVerdict } from "@/lib/badminton";
import {
  type MatchRules,
  type PresetId,
  PRESETS,
  findPreset,
  gameWinner,
  matchWinner,
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
  nearSide: boolean;
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
    }
  }

  return {
    ...prev,
    score: newScore,
    server: winner,
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
    matchStartedAt: prev.matchStartedAt ?? now,
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
      return {
        ...controller,
        match: action.match,
        history: action.history?.slice(-60) ?? [],
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
          : `gets the point after ${prev.names[action.team]} committed a ${action.fault}`;
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
      next = initialState(prev.preset);
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
    case "nearSide":
      next = { ...prev, nearSide: action.value };
      remember = true;
      break;
    case "preset": {
      const preset = findPreset(action.id);
      next = {
        ...prev,
        preset,
        score: [0, 0],
        games: [0, 0],
        completedGames: [],
        matchOver: false,
        matchWinnerTeam: null,
        rallyHistory: [],
        longestRallyMs: 0,
        matchStartedAt: null,
        rallyStartedAt: null,
        log: [
          { text: `New match — ${preset.label}.`, score: [0, 0], at: action.at, kind: "info" },
          ...prev.log,
        ],
      };
      remember = true;
      break;
    }
    case "rally":
      next = prev.rallyStartedAt ? prev : { ...prev, rallyStartedAt: action.at };
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
