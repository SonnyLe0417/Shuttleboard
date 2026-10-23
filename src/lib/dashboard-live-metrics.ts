// Opt-in local diagnostics. This module is excluded from production builds.
import type { QueryClient } from "@tanstack/react-query";
let enabled = false;
let dispose: (() => void) | undefined;
let run = 0;
if (import.meta.hot) import.meta.hot.dispose(() => dispose?.());
export function startDashboardLiveMetrics(routeStart: number, queryClient?: QueryClient) {
  enabled ||= new URLSearchParams(location.search).get("dashboardMetrics") === "1";
  if (!enabled) return;
  // Development module loads can fill the browser's default 250-entry buffer
  // before a later dashboard refresh. Reserve space for the navigation scenarios.
  performance.setResourceTimingBufferSize(2_000);
  dispose?.();
  const previous = document.querySelector("[data-dashboard-live-metrics]");
  previous?.remove();
  const output = document.createElement("pre");
  output.dataset.dashboardLiveMetrics = "true";
  output.dataset.run = String(++run);
  output.setAttribute("aria-label", "Local dashboard performance diagnostics");
  output.style.cssText =
    "white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;border:1px solid #888;font:12px monospace";
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
  const firstRoute = !performance.getEntriesByName("dashboard-live-route").length;
  performance.mark("dashboard-live-route");
  const start = firstRoute ? 0 : routeStart;
  const previousLeave = performance.getEntriesByName("dashboard-route-leave").at(-1)?.startTime;
  const queryTimings = () =>
    queryClient
      ?.getQueryCache()
      .getAll()
      .filter((query) => query.queryKey[0] === "dashboard")
      .map((query) => ({
        section: query.queryKey[1] === "core" ? "core" : "summary",
        dataAgeMs: query.state.dataUpdatedAt ? Date.now() - query.state.dataUpdatedAt : null,
        fetchStatus: query.state.fetchStatus,
        status: query.state.status,
      })) ?? [];
  const initialQueryTimings = queryTimings();
  // Intent preloading or a mounted query can begin before the route loader runs.
  // Join in-flight responses to their query's start mark, not only to the loader.
  const requestStart = Math.min(
    start,
    ...(previousLeave === undefined
      ? []
      : ["core", "summary"].flatMap((section) =>
          performance
            .getEntriesByName(`dashboard-${section}-fetch-start`)
            .filter((entry) => entry.startTime >= previousLeave)
            .map((entry) => entry.startTime),
        )),
    ...initialQueryTimings
      .filter((query) => query.fetchStatus === "fetching")
      .map(
        (query) =>
          performance.getEntriesByName(`dashboard-${query.section}-fetch-start`).at(-1)
            ?.startTime ?? start,
      ),
  );
  let primaryMs: number | null = null;
  let summaryMs: number | null = null;
  let detailsStart: number | null = null;
  let detailsMs: number | null = null;
  let visibilityChanged = false;
  const initialVisibility = document.visibilityState;
  const onVisibilityChange = () => {
    visibilityChanged = true;
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  const endpointName = (entry: PerformanceResourceTiming) => {
    const id = new URL(entry.name).pathname.split("/").at(-1) ?? "";
    try {
      const metadata = JSON.parse(atob(id.replaceAll("-", "+").replaceAll("_", "/")));
      return String(metadata.export).split("_createServerFn")[0];
    } catch {
      return "server-function";
    }
  };
  const render = () => {
    const entries = (
      performance.getEntriesByType("resource") as PerformanceResourceTiming[]
    ).filter(
      (entry) =>
        entry.responseEnd >= requestStart &&
        entry.name.includes("/_serverFn/") &&
        [
          "getDashboardCore",
          "getDashboardSummary",
          "getProgressSummary",
          "getOnboardingStatus",
        ].includes(endpointName(entry)),
    );
    if (!output.isConnected) document.body.append(output);
    output.dataset.complete = String(summaryMs !== null);
    output.dataset.detailsComplete = String(detailsMs !== null);
    output.dataset.dashboardRefreshed = String(
      ["getDashboardCore", "getDashboardSummary"].every((name) =>
        entries.some((entry) => endpointName(entry) === name && entry.responseStart > 0),
      ),
    );
    output.textContent = JSON.stringify({
      environment: "development; unthrottled",
      scenario: firstRoute ? "document-load" : "client-return",
      viewport: { width: innerWidth, height: innerHeight },
      readinessMetric: "DOM availability, not paint or interaction latency",
      startMarker: firstRoute ? "document-navigation" : "route-loader",
      initialQueryTimings,
      requestWindowStartMs: requestStart - start,
      currentQueryTimings: queryTimings(),
      initialVisibility,
      visibilityChanged,
      primaryMs,
      summaryMs,
      detailsMs,
      detailsStartMs: detailsStart === null ? null : detailsStart - start,
      documentTtfbMs: navigation?.responseStart ?? null,
      requests: entries.map((entry) => ({
        // Never include query strings, request bodies, response contents or credentials.
        endpoint: endpointName(entry),
        startMs: entry.startTime - start,
        durationMs: entry.duration,
        ttfbMs: entry.responseStart > 0 ? entry.responseStart - entry.startTime : null,
        responseTimingAvailable: entry.responseStart > 0,
        transferBytes: entry.transferSize,
        decodedBytes: entry.decodedBodySize,
      })),
    });
  };
  const sample = () => {
    if (location.pathname !== "/dashboard") return;
    if (primaryMs === null && document.querySelector('[data-dashboard-ready="true"]'))
      primaryMs = performance.now() - start;
    if (summaryMs === null && document.querySelector('[data-dashboard-summary="ready"]'))
      summaryMs = performance.now() - start;
    if (
      detailsStart !== null &&
      detailsMs === null &&
      document.querySelector('[data-dashboard-details="ready"]')
    )
      detailsMs = performance.now() - detailsStart;
    render();
  };
  const onClick = (event: MouseEvent) => {
    const summary = event.target instanceof Element ? event.target.closest("summary") : null;
    if (!summary?.textContent?.includes("More progress and shortcuts")) return;
    if (summary.parentElement?.hasAttribute("open")) return;
    detailsStart = performance.now();
    detailsMs = null;
    queueMicrotask(sample);
  };
  document.addEventListener("click", onClick, true);
  const dom = new MutationObserver((records) => {
    if (records.some((record) => record.target !== output && !output.contains(record.target)))
      sample();
  });
  // Keep the output outside the observed subtree: diagnostic updates must never
  // trigger another diagnostic update, including during development hot reloads.
  const main = document.getElementById("main-content");
  if (main) dom.observe(main, { childList: true, subtree: true, attributes: true });
  const resources = new PerformanceObserver(render);
  resources.observe({ type: "resource", buffered: true });
  queueMicrotask(sample);
  const timeout = setTimeout(() => {
    resources.disconnect();
    dom.disconnect();
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    output.dataset.expired = "true";
  }, 120_000);
  dispose = () => {
    dom.disconnect();
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    resources.disconnect();
    clearTimeout(timeout);
    output.remove();
  };
}
