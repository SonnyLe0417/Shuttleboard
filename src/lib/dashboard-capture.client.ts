import type { QueryClient } from "@tanstack/react-query";
import { canCapture, captureSample, type CaptureSample } from "./dashboard-capture";

const storageKey = "shuttleboard.localDashboardCapture.v1";
type Stored = {
  startedAt: number;
  nextSample: number;
  samples: CaptureSample[];
  consumed?: number[];
};
export function startDashboardCapture(
  queryClient: QueryClient | undefined,
  firstRoute: boolean,
  endpoint: (entry: PerformanceResourceTiming) => string,
) {
  let state: Stored;
  try {
    const saved = sessionStorage.getItem(storageKey);
    if (!saved && new URLSearchParams(location.search).get("dashboardCapture") !== "1")
      return () => {};
    state = saved
      ? JSON.parse(saved)
      : {
          startedAt: Date.now(),
          nextSample: crypto.getRandomValues(new Uint32Array(1))[0],
          samples: [],
        };
  } catch {
    return () => {};
  }
  let visibleChanged = document.visibilityState !== "visible";
  const consumed = (state.consumed ??= []);
  const entries = new Map<number, number>();
  const panel = document.createElement("pre");
  panel.dataset.dashboardCapture = "true";
  panel.setAttribute("aria-label", "Local summary capture session");
  panel.style.cssText =
    "white-space:pre-wrap;overflow-wrap:anywhere;font:12px monospace;padding:16px";
  const save = () => {
    const report = {
      version: 1,
      environment: "development; unthrottled",
      samples: state.samples.map(captureSample),
      capped: state.samples.length >= 60 || Date.now() - state.startedAt >= 1_800_000,
    };
    panel.textContent = JSON.stringify(report);
    panel.dataset.sampleCount = String(state.samples.length);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* Keep in-memory export when storage is unavailable. */
    }
  };
  const query = () =>
    queryClient
      ?.getQueryCache()
      .getAll()
      .find((q) => q.queryKey[0] === "dashboard" && q.queryKey[1] === "summary");
  const sample = () => {
    for (const entry of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
      if (!entry.name.includes("/_serverFn/") || endpoint(entry) !== "getDashboardSummary")
        continue;
      // Each resource is captured once per document, even across client navigations.
      if (
        entry.startTime <
          (performance.getEntriesByName("dashboard-capture-consumed").at(-1)?.startTime ?? -1) &&
        !entries.has(entry.startTime)
      )
        continue;
      let id = entries.get(entry.startTime);
      if (id === undefined) {
        const resourceKey = performance.timeOrigin + entry.startTime;
        if (consumed.includes(resourceKey)) continue;
        if (!canCapture(state.samples.length, state.startedAt, resourceKey)) continue;
        consumed.push(resourceKey);
        id = state.nextSample++;
        entries.set(entry.startTime, id);
      }
      const status = entry.responseStatus;
      const q = query();
      const previous = state.samples.find((row) => row.sample === id);
      const record = captureSample({
        sample: id,
        scenario:
          !firstRoute ||
          performance
            .getEntriesByName("dashboard-route-leave")
            .some((mark) => mark.startTime <= entry.startTime)
            ? "stale-return"
            : "document-load",
        outcome: status >= 200 && status < 400 ? "success" : status >= 400 ? "failure" : "unknown",
        queryOutcome:
          previous?.queryOutcome ??
          (q?.state.fetchStatus === "idle"
            ? q.state.status === "success"
              ? "success"
              : q.state.status === "error"
                ? "failure"
                : null
            : null),
        durationMs: entry.responseStart > 0 ? entry.duration : null,
        slow: null,
        visibilityChanged: visibleChanged,
        serverTiming: entry.serverTiming.map((span) => ({
          name: span.name,
          durationMs: span.duration,
        })),
      });
      const index = state.samples.findIndex((row) => row.sample === id);
      if (index < 0) state.samples.push(record);
      else state.samples[index] = record;
    }
    save();
  };
  const onVisibility = () => {
    visibleChanged = true;
    sample();
  };
  const onPageHide = () => {
    sample();
    if (
      query()?.state.fetchStatus === "fetching" &&
      state.samples.length < 60 &&
      Date.now() - state.startedAt < 1_800_000
    ) {
      state.samples.push(
        captureSample({
          sample: state.nextSample++,
          scenario: firstRoute ? "document-load" : "stale-return",
          outcome: "interrupted",
          queryOutcome: null,
          durationMs: null,
          slow: null,
          visibilityChanged: visibleChanged,
          serverTiming: [],
        }),
      );
      save();
    }
  };
  const download = document.createElement("button");
  download.textContent = "Export local timing session";
  download.onclick = () => {
    sample();
    const url = URL.createObjectURL(
      new Blob([panel.textContent ?? ""], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "dashboard-summary-capture.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  document.body.append(panel, download);
  const observer = new PerformanceObserver(sample);
  observer.observe({ type: "resource", buffered: true });
  const unsubscribe = queryClient?.getQueryCache().subscribe(sample);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  sample();
  return () => {
    sample();
    performance.mark("dashboard-capture-consumed");
    observer.disconnect();
    unsubscribe?.();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    panel.remove();
    download.remove();
  };
}
