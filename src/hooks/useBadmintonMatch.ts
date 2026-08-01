import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { type GameMode, type Side, correctServeSide, landingVerdict } from "@/lib/badminton";
import {
  type MatchRules,
  type PresetId,
  PRESETS,
  findPreset,
  isGameOver,
  isMatchPoint,
  gameWinner,
  matchWinner,
} from "@/lib/badminton-rules";
import { sfx } from "@/lib/audio";
import { haptics } from "@/lib/haptics";

const DEFAULT_NAMES: [string, string] = ["Team A", "Team B"];
const DEFAULT_DOUBLES: [string, string, string, string] = ["A1", "A2", "B1", "B2"];
const MATCH_DRAFT_KEY = "shuttleboard.match-draft.v1";

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

interface Snapshot {
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

function initialState(preset: MatchRules): MatchState {
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

export function useBadmintonMatch() {
  const [state, setState] = useState<MatchState>(() => initialState(PRESETS[0]));
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [draftReady, setDraftReady] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Restore an in-progress courtside session after hydration. Saved History
  // remains the cloud source of truth; this draft protects active play from
  // refreshes, closed tabs, and temporary connectivity loss.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(MATCH_DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<MatchState>;
        const preset = findPreset(parsed.preset?.id ?? PRESETS[0].id);
        const restored: MatchState = {
          ...initialState(preset),
          ...parsed,
          preset,
          score:
            Array.isArray(parsed.score) && parsed.score.length === 2
              ? [
                  Math.max(0, Number(parsed.score[0]) || 0),
                  Math.max(0, Number(parsed.score[1]) || 0),
                ]
              : [0, 0],
          games:
            Array.isArray(parsed.games) && parsed.games.length === 2
              ? [
                  Math.max(0, Number(parsed.games[0]) || 0),
                  Math.max(0, Number(parsed.games[1]) || 0),
                ]
              : [0, 0],
          completedGames: Array.isArray(parsed.completedGames)
            ? parsed.completedGames
                .filter(
                  (game): game is CompletedGame =>
                    Boolean(game) && Number.isFinite(game.a) && Number.isFinite(game.b),
                )
                .slice(-5)
                .map((game) => ({ a: Math.max(0, game.a), b: Math.max(0, game.b) }))
            : [],
          names:
            Array.isArray(parsed.names) && parsed.names.length === 2
              ? [String(parsed.names[0]), String(parsed.names[1])]
              : [...DEFAULT_NAMES],
          doublesNames:
            Array.isArray(parsed.doublesNames) && parsed.doublesNames.length === 4
              ? (parsed.doublesNames.map(String) as [string, string, string, string])
              : [...DEFAULT_DOUBLES],
          log: Array.isArray(parsed.log) ? parsed.log.slice(0, 250) : [],
          rallyHistory: Array.isArray(parsed.rallyHistory) ? parsed.rallyHistory.slice(-500) : [],
          rallyStartedAt: null,
          celebrateAt: null,
          celebrateKind: null,
        };
        setState(restored);
      }
    } catch {
      window.localStorage.removeItem(MATCH_DRAFT_KEY);
    } finally {
      setDraftReady(true);
    }
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    window.localStorage.setItem(MATCH_DRAFT_KEY, JSON.stringify(state));
  }, [draftReady, state]);

  const teamName = useCallback(
    (index: 0 | 1) => state.names[index].trim() || (index === 0 ? "Team A" : "Team B"),
    [state.names],
  );

  const pushHistory = useCallback(() => {
    setHistory((prev) => [...prev, snapshotOf(stateRef.current)].slice(-60));
  }, []);

  const setName = useCallback((index: 0 | 1, name: string) => {
    setState((prev) => ({
      ...prev,
      names: index === 0 ? [name, prev.names[1]] : [prev.names[0], name],
    }));
  }, []);

  const setDoublesName = useCallback((i: 0 | 1 | 2 | 3, name: string) => {
    setState((prev) => {
      const next = [...prev.doublesNames] as [string, string, string, string];
      next[i] = name;
      return { ...prev, doublesNames: next };
    });
  }, []);

  const setMode = useCallback(
    (mode: GameMode) => {
      pushHistory();
      setState((prev) => ({ ...prev, mode }));
    },
    [pushHistory],
  );

  const setDeclaredSide = useCallback(
    (side: Side) => {
      pushHistory();
      setState((prev) => ({ ...prev, declaredSide: side }));
    },
    [pushHistory],
  );

  const setServeCheck = useCallback(
    (serveCheck: boolean) => {
      pushHistory();
      setState((prev) => ({ ...prev, serveCheck }));
    },
    [pushHistory],
  );

  const setNearSide = useCallback(
    (nearSide: boolean) => {
      pushHistory();
      setState((prev) => ({ ...prev, nearSide }));
    },
    [pushHistory],
  );

  const setPreset = useCallback(
    (id: PresetId) => {
      pushHistory();
      const preset = findPreset(id);
      setState((prev) => ({
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
          {
            text: `New match — ${preset.label}.`,
            score: [0, 0],
            at: Date.now(),
            kind: "info",
          },
          ...prev.log,
        ],
      }));
    },
    [pushHistory],
  );

  const startRally = useCallback(() => {
    setState((prev) => (prev.rallyStartedAt ? prev : { ...prev, rallyStartedAt: Date.now() }));
  }, []);

  const addPoint = useCallback(
    (winner: 0 | 1, reason = "won the rally") => {
      const prev = stateRef.current;
      if (prev.matchOver) return;
      pushHistory();
      const now = Date.now();
      const rallyMs = prev.rallyStartedAt ? now - prev.rallyStartedAt : 0;
      const score: [number, number] = [prev.score[0], prev.score[1]];
      score[winner] += 1;

      const newRallies: RallyRecord[] =
        rallyMs > 0 ? [...prev.rallyHistory, { ms: rallyMs, winner, at: now }] : prev.rallyHistory;
      const newLongest = Math.max(prev.longestRallyMs, rallyMs);
      const winnerName = winner === 0 ? teamName(0) : teamName(1);
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
          sfx.matchWin();
          haptics.win();
        } else {
          celebrateAt = now;
          celebrateKind = "game";
          newScore = [0, 0];
          sfx.gamePoint();
          haptics.bump();
        }
      } else {
        sfx.point();
        haptics.tap();
      }

      setState({
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
      });
    },
    [teamName, pushHistory],
  );

  const addFault = useCallback(
    (team: 0 | 1, faultType: string) => {
      const other = (team === 0 ? 1 : 0) as 0 | 1;
      sfx.fault();
      addPoint(
        other,
        `gets the point after ${team === 0 ? stateRef.current.names[0] : stateRef.current.names[1]} committed a ${faultType}`,
      );
    },
    [addPoint],
  );

  const undo = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const snap = prev[prev.length - 1];
      setState((s) => ({
        ...s,
        ...snap,
        landing: null,
        celebrateAt: null,
        celebrateKind: null,
      }));
      return prev.slice(0, -1);
    });
  }, []);

  const reset = useCallback(() => {
    pushHistory();
    setState((prev) => initialState(prev.preset));
  }, [pushHistory]);

  const dismissCelebration = useCallback(() => {
    setState((prev) => ({ ...prev, celebrateAt: null, celebrateKind: null }));
  }, []);

  const markLanding = useCallback((x: number, y: number) => {
    setState((prev) => {
      const verdict = landingVerdict(
        x,
        y,
        prev.mode,
        prev.serveCheck,
        prev.nearSide,
        prev.score[prev.server],
      );
      const at = Date.now();
      return {
        ...prev,
        landing: { x, y },
        log: [
          {
            text: `${verdict.isIn ? "In" : "Out"} at ${Math.round(x * 100)}%, ${Math.round(y * 100)}% — ${verdict.modeText}`,
            score: [...prev.score] as [number, number],
            at,
            kind: "line",
          },
          ...prev.log,
        ],
      };
    });
  }, []);

  const correctSide = correctServeSide(state.score[state.server]);
  const sideWarning = state.declaredSide !== correctSide;
  const matchPoint = isMatchPoint(state.score, state.preset);
  const gameOver = isGameOver(state.score, state.preset);

  const doublesRotation = useMemo(() => {
    if (state.mode !== "doubles") return null;
    // In doubles, the server is a specific player from the serving team.
    // Right service court (even score) → player A1/B1 serves initially;
    // partners swap on each point won while serving.
    const team = state.server;
    const serverScore = state.score[team];
    const teamPlayers: [string, string] =
      team === 0
        ? [state.doublesNames[0], state.doublesNames[1]]
        : [state.doublesNames[2], state.doublesNames[3]];
    // Deterministic simple rotation: on even score, first-listed player serves; odd, partner.
    const currentServer = serverScore % 2 === 0 ? teamPlayers[0] : teamPlayers[1];
    const receiverTeam: [string, string] =
      team === 0
        ? [state.doublesNames[2], state.doublesNames[3]]
        : [state.doublesNames[0], state.doublesNames[1]];
    return {
      server: currentServer,
      partner: teamPlayers[0] === currentServer ? teamPlayers[1] : teamPlayers[0],
      receivers: receiverTeam,
      side: correctSide,
    };
  }, [state.mode, state.server, state.score, state.doublesNames, correctSide]);

  // Keep sfx/haptics in sync with prefs by reading window flags set by settings init
  useEffect(() => {
    const sync = () => {
      const w = window as unknown as { __sbSound?: boolean; __sbHaptics?: boolean };
      sfx.setEnabled(w.__sbSound !== false);
      haptics.setEnabled(w.__sbHaptics !== false);
    };
    sync();
    window.addEventListener("sb-prefs-change", sync);
    return () => window.removeEventListener("sb-prefs-change", sync);
  }, []);

  return {
    state,
    setName,
    setDoublesName,
    setMode,
    setDeclaredSide,
    setServeCheck,
    setNearSide,
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
    matchPoint,
    gameOver,
    doublesRotation,
    canUndo: history.length > 0,
  };
}

export type UseBadmintonMatch = ReturnType<typeof useBadmintonMatch>;
