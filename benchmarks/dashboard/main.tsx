import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Link,
  Outlet,
} from "@tanstack/react-router";
import { DashboardPage, Route as dashboardDefinition } from "benchmark-dashboard";
import "../../src/styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 30_000, gcTime: 300_000, refetchOnWindowFocus: false },
  },
});
const root = createRootRoute({
  component: () => (
    <QueryClientProvider client={queryClient}>
      <div className="club-app">
        <nav>
          <Link to="/dashboard">Dashboard</Link> · <Link to="/away">Away</Link>
        </nav>
        <main className="p-4">
          <Outlet />
        </main>
      </div>
    </QueryClientProvider>
  ),
});
const dashboard = createRoute({
  getParentRoute: () => root,
  path: "dashboard",
  loader: () => dashboardDefinition.options.loader?.({ context: { queryClient } } as any),
  component: DashboardPage,
});
const away = createRoute({
  getParentRoute: () => root,
  path: "away",
  component: () => <p>Return to your dashboard.</p>,
});
const router = createRouter({ routeTree: root.addChildren([dashboard, away]) });
const marks: {
  start: number;
  mode: string;
  readyMs?: number;
  summaryReadyMs?: number;
  requestStart?: number;
  dataReadyMs?: number;
} = {
  start: 0,
  mode: "cold",
};
function samplePaint() {
  const entries = queryClient.getQueryCache().getAll();
  const core: any = queryClient.getQueryData(["dashboard", "core"]);
  const matches = core?.recentMatches ?? queryClient.getQueryData(["matches", "mine"]);
  const summary: any =
    entries.find((query) => query.queryKey[0] === "dashboard" && query.queryKey[1] === "summary")
      ?.state.data ?? core;
  const progress: any = queryClient.getQueryData(["progress", "summary"]);
  const expanded = document.querySelector("details[open]");
  const essential = Boolean(
    core &&
    matches &&
    document.querySelector(".club-play-action a") &&
    !document.querySelector(".club-recent-matches")?.textContent?.includes("Loading your matches"),
  );
  const detail = Boolean(
    expanded && progress && expanded.textContent?.includes(`${progress.progress.total_xp} XP`),
  );
  const summaryPainted =
    essential &&
    summary?.progress &&
    [...document.querySelectorAll("p")].some(
      (p) => p.textContent === String(summary.progress.total_xp),
    );
  if (marks.readyMs === undefined && (marks.mode === "details" ? detail : essential)) {
    marks.readyMs = performance.now() - marks.start;
    if (marks.requestStart !== undefined)
      marks.dataReadyMs = performance.now() - marks.requestStart;
  }
  if (marks.summaryReadyMs === undefined && (marks.mode === "details" ? detail : summaryPainted))
    marks.summaryReadyMs = performance.now() - marks.start;
}
function scheduleSample() {
  requestAnimationFrame(samplePaint);
}
new MutationObserver(scheduleSample).observe(document.getElementById("root")!, {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
});
queryClient.getQueryCache().subscribe(scheduleSample);
window.addEventListener("benchmark-request-start", () => {
  marks.requestStart ??= performance.now();
});
// Test-only control: age cached data without making the suite wait 61 seconds.
Object.assign(window, {
  benchmark: {
    queryClient,
    router,
    marks,
    begin: (mode: string) => {
      marks.start = performance.now();
      marks.mode = mode;
      delete marks.readyMs;
      delete marks.summaryReadyMs;
      delete marks.requestStart;
      delete marks.dataReadyMs;
    },
    age: () => {
      for (const query of queryClient.getQueryCache().getAll())
        query.setState({ dataUpdatedAt: Date.now() - 61_000 });
    },
  },
});
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
