import type { QueryClient } from "@tanstack/react-query";

export const DASHBOARD_CORE_QUERY_KEY = ["dashboard", "core"] as const;
export const DASHBOARD_SUMMARY_QUERY_KEY = ["dashboard", "summary"] as const;
export function invalidateDashboard(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: ["dashboard"] });
}
export const DASHBOARD_DETAILS_QUERY_KEY = ["dashboard", "details"] as const;
export const MATCHES_QUERY_KEY = ["matches", "mine"] as const;
export const PROFILE_QUERY_KEY = ["me", "profile"] as const;
export const PREFERENCES_QUERY_KEY = ["me", "preferences"] as const;
export const PROGRESS_QUERY_KEY = ["progress", "summary"] as const;
