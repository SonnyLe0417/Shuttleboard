export type DashboardSpan =
  | "auth_setup"
  | "module_load"
  | "matches"
  | "quests"
  | "progress"
  | "insights"
  | "completed"
  | "aggregate"
  | "total";

// Fixed labels and durations only: never include query parameters, errors or user data.
export function dashboardTimer(now = () => performance.now()) {
  const started = now();
  const spans = new Map<DashboardSpan, number>();
  return {
    mark(name: DashboardSpan) {
      spans.set(name, now() - started);
    },
    async measure<T>(name: DashboardSpan, work: () => T | PromiseLike<T>): Promise<T> {
      const start = now();
      try {
        return await work();
      } finally {
        spans.set(name, now() - start);
      }
    },
    header() {
      return [...spans].map(([name, ms]) => `dash_${name};dur=${ms.toFixed(1)}`).join(", ");
    },
  };
}
