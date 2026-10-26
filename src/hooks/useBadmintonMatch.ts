import {
  createDurableController,
  reduceDurableMatch,
  type DurableAction,
} from "@/lib/durable-match-controller";
import { useState, useCallback, useEffect, useMemo, useRef, useReducer } from "react";
import { type GameMode, type Side, correctServeSide } from "@/lib/badminton";
import {
  type PresetId,
  PRESETS,
  findPreset,
  isGameOver,
  pointCall,
  type PointCall,
} from "@/lib/badminton-rules";
import {
  initialState,
  DEFAULT_NAMES,
  DEFAULT_DOUBLES,
  MATCH_DRAFT_KEY,
  type MatchState,
  doublesServe,
  type CompletedGame,
  type Snapshot,
} from "@/lib/match-controller";
export type { MatchState, CompletedGame, LogEntry, RallyRecord } from "@/lib/match-controller";
import { sfx } from "@/lib/audio";
import { haptics } from "@/lib/haptics";

export function useBadmintonMatch(managed = false) {
  const [controller, dispatch] = useReducer(
    (current: ReturnType<typeof createDurableController>, action: DurableAction) =>
      reduceDurableMatch(current, action, managed),
    undefined,
    createDurableController,
  );
  const { match: state, history } = controller;
  const playedEffectRef = useRef(0);
  const [draftReady, setDraftReady] = useState(false);

  // Restore an in-progress courtside session after hydration. Saved History
  // remains the cloud source of truth; this draft protects active play from
  // refreshes, closed tabs, and temporary connectivity loss.
  useEffect(() => {
    if (managed) {
      setDraftReady(true);
      return;
    }
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
        dispatch({ type: "restore", match: restored });
      }
    } catch {
      try {
        window.localStorage.removeItem(MATCH_DRAFT_KEY);
      } catch {
        // Storage may be disabled; active scoring still works in memory.
      }
    } finally {
      setDraftReady(true);
    }
  }, [managed]);

  useEffect(() => {
    if (!draftReady || managed) return;
    try {
      window.localStorage.setItem(MATCH_DRAFT_KEY, JSON.stringify(state));
    } catch {
      // Quota or privacy settings must not interrupt an active match.
    }
  }, [draftReady, state, managed]);

  const teamName = useCallback(
    (index: 0 | 1) => state.names[index].trim() || (index === 0 ? "Team A" : "Team B"),
    [state.names],
  );

  useEffect(() => {
    for (const effect of controller.effects) {
      if (effect.sequence <= playedEffectRef.current) continue;
      playedEffectRef.current = effect.sequence;
      if (effect.kind === "fault") sfx.fault();
      else if (effect.kind === "match") {
        sfx.matchWin();
        haptics.win();
      } else if (effect.kind === "game") {
        sfx.gamePoint();
        haptics.bump();
      } else {
        sfx.point();
        haptics.tap();
      }
    }
    const last = controller.effects.at(-1);
    if (last) dispatch({ type: "ack", sequence: last.sequence });
  }, [controller.effects]);
  const setName = useCallback(
    (index: 0 | 1, name: string) => dispatch({ type: "name", index, name }),
    [],
  );
  const setDoublesName = useCallback(
    (index: 0 | 1 | 2 | 3, name: string) => dispatch({ type: "doublesName", index, name }),
    [],
  );
  const setMode = useCallback((value: GameMode) => dispatch({ type: "mode", value }), []);
  const setDeclaredSide = useCallback((value: Side) => dispatch({ type: "side", value }), []);
  const setServeCheck = useCallback(
    (value: boolean) => dispatch({ type: "serveCheck", value }),
    [],
  );
  const setNearSide = useCallback((value: boolean) => dispatch({ type: "nearSide", value }), []);
  const setFirstServer = useCallback((team: 0 | 1) => dispatch({ type: "firstServer", team }), []);
  const setPreset = useCallback(
    (id: PresetId) => dispatch({ type: "preset", id, at: Date.now() }),
    [],
  );
  const startRally = useCallback(() => dispatch({ type: "rally", at: Date.now() }), []);
  const addPoint = useCallback(
    (team: 0 | 1, reason = "won the rally") =>
      dispatch({ type: "point", team, reason, at: Date.now() }),
    [],
  );
  const addFault = useCallback(
    (team: 0 | 1, fault: string) => dispatch({ type: "fault", team, fault, at: Date.now() }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  const dismissCelebration = useCallback(() => dispatch({ type: "dismiss" }), []);
  const markLanding = useCallback(
    (x: number, y: number) => dispatch({ type: "landing", x, y, at: Date.now() }),
    [],
  );

  const correctSide = correctServeSide(state.score[state.server]);
  const sideWarning = state.declaredSide !== correctSide;
  const pointCalls: [PointCall, PointCall] = [
    pointCall(state.score, state.games, 0, state.preset),
    pointCall(state.score, state.games, 1, state.preset),
  ];
  const matchPoint = pointCalls.includes("match");
  const gamePoint = pointCalls.includes("game");
  const gameOver = isGameOver(state.score, state.preset);

  const doublesRotation = useMemo(
    () =>
      state.mode === "doubles"
        ? doublesServe({
            server: state.server,
            score: state.score,
            rightCourt: state.rightCourt,
            doublesNames: state.doublesNames,
          })
        : null,
    [state.mode, state.server, state.score, state.rightCourt, state.doublesNames],
  );

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
    restoreDraft: useCallback(
      (match: MatchState, history?: Snapshot[]) => dispatch({ type: "restore", match, history }),
      [],
    ),
    markDeviceSaved: useCallback(
      (endedAt: number) => dispatch({ type: "device-saved", endedAt }),
      [],
    ),
    deviceSaved: controller.deviceSaved,
    undoHistory: history,
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
    gameOver,
    doublesRotation,
    canUndo: history.length > 0,
  };
}

export type UseBadmintonMatch = ReturnType<typeof useBadmintonMatch>;
