const spanNames = new Set(
  [
    "auth_setup",
    "module_load",
    "matches",
    "quests",
    "progress",
    "insights",
    "completed",
    "aggregate",
    "total",
  ].map((name) => `dash_${name}`),
);
export type CaptureSample = {
  sample: number;
  scenario: "document-load" | "stale-return";
  outcome: "success" | "failure" | "unknown" | "interrupted";
  queryOutcome: "success" | "failure" | null;
  durationMs: number | null;
  slow: boolean | null;
  visibilityChanged: boolean;
  serverTiming: { name: string; durationMs: number }[];
};
export function captureSample(input: CaptureSample): CaptureSample {
  const durationMs =
    typeof input.durationMs === "number" &&
    Number.isFinite(input.durationMs) &&
    input.durationMs >= 0
      ? input.durationMs
      : null;
  return {
    sample: input.sample,
    scenario: input.scenario === "stale-return" ? "stale-return" : "document-load",
    outcome: ["success", "failure", "interrupted"].includes(input.outcome)
      ? input.outcome
      : "unknown",
    queryOutcome:
      input.queryOutcome === "success" || input.queryOutcome === "failure"
        ? input.queryOutcome
        : null,
    durationMs,
    slow: durationMs === null ? null : durationMs > 2_000,
    visibilityChanged: Boolean(input.visibilityChanged),
    serverTiming: input.serverTiming
      .filter(
        (span) =>
          spanNames.has(span.name) && Number.isFinite(span.durationMs) && span.durationMs >= 0,
      )
      .map((span) => ({ name: span.name, durationMs: span.durationMs })),
  };
}

export function canCapture(count: number, startedAt: number, now: number) {
  return count < 60 && now - startedAt < 1_800_000;
}
