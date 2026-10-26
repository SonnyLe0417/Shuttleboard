import {
  reduceMatch,
  createMatchController,
  type MatchAction,
  type MatchState,
} from "./match-controller";
export type DurableAction = MatchAction | { type: "device-saved"; endedAt: number };
export const completionTime = (state: MatchState) =>
  state.log.find((row) => row.kind === "match")?.at ?? 0;
export function createDurableController() {
  return { ...createMatchController(), deviceSaved: false };
}
export function reduceDurableMatch(
  state: ReturnType<typeof createDurableController>,
  action: DurableAction,
  managed: boolean,
) {
  if (action.type === "device-saved")
    return {
      ...state,
      deviceSaved: state.match.matchOver && completionTime(state.match) === action.endedAt,
    };
  if (managed && state.match.matchOver) {
    if (action.type === "reset" || action.type === "preset") {
      if (!state.deviceSaved) return state;
    } else if (!["dismiss", "ack", "restore"].includes(action.type)) return state;
  }
  const next = reduceMatch(state, action);
  return {
    ...next,
    deviceSaved:
      action.type === "reset" || action.type === "preset" || action.type === "restore"
        ? false
        : state.deviceSaved,
  };
}
