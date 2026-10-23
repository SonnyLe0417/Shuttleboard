import type { DashboardCoreData, DashboardSummaryData } from "./dashboard-model";
import { DASHBOARD_CORE_QUERY_KEY, DASHBOARD_SUMMARY_QUERY_KEY } from "./query-keys";
function observedFetch<T>(section: "core" | "summary", fetcher: () => Promise<T>) {
  if (!import.meta.env?.DEV || typeof window === "undefined") return fetcher;
  return () => {
    performance.mark(`dashboard-${section}-fetch-start`);
    return fetcher();
  };
}
export function dashboardCoreOptions(fetchCore: () => Promise<DashboardCoreData>) {
  return {
    queryKey: DASHBOARD_CORE_QUERY_KEY,
    queryFn: observedFetch("core", fetchCore),
    staleTime: 60_000,
    gcTime: 300_000,
  };
}
export function dashboardSummaryOptions(
  fetchSummary: (input: { data: { weekStart: string } }) => Promise<DashboardSummaryData>,
  weekStart: string,
) {
  return {
    queryKey: [...DASHBOARD_SUMMARY_QUERY_KEY, weekStart],
    queryFn: observedFetch("summary", () => fetchSummary({ data: { weekStart } })),
    staleTime: 60_000,
    gcTime: 300_000,
  };
}
