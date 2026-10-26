import test from "node:test";
import assert from "node:assert/strict";
import { startDashboardCapture } from "../src/lib/dashboard-capture.client.ts";

test("capture survives reloads, avoids duplicates, records interruption and cleans observers", () => {
  const saved = new Map(),
    nodes = [],
    listeners = new Map();
  let resources = [],
    timeOrigin = Date.now(),
    status = "success",
    fetchStatus = "idle";
  let observerCount = 0,
    subscriptions = 0;
  const element = () => ({
    dataset: {},
    style: {},
    setAttribute() {},
    remove() {
      nodes.splice(nodes.indexOf(this), 1);
    },
  });
  const originals = new Map();
  const install = (name, value) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  };
  const target = {
    addEventListener(name, fn) {
      listeners.set(name, fn);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
  };
  install("document", {
    ...target,
    visibilityState: "visible",
    createElement: element,
    body: {
      append(...elements) {
        nodes.push(...elements);
      },
    },
  });
  install("window", target);
  install("location", { search: "?dashboardCapture=1" });
  install("sessionStorage", {
    getItem: (key) => saved.get(key),
    setItem: (key, value) => saved.set(key, value),
  });
  install("performance", {
    get timeOrigin() {
      return timeOrigin;
    },
    getEntriesByType: () => resources,
    getEntriesByName: () => [],
    mark() {},
  });
  install(
    "PerformanceObserver",
    class {
      observe() {
        observerCount++;
      }
      disconnect() {
        observerCount--;
      }
    },
  );
  const queryClient = {
    getQueryCache: () => ({
      getAll: () => [{ queryKey: ["dashboard", "summary"], state: { status, fetchStatus } }],
      subscribe: () => {
        subscriptions++;
        return () => subscriptions--;
      },
    }),
  };
  const report = () => JSON.parse(nodes.find((node) => node.dataset.dashboardCapture)?.textContent);
  const resource = (startTime, responseStatus = 200) => ({
    name: "http://local/_serverFn/summary",
    startTime,
    responseStatus,
    responseStart: 10,
    duration: 25,
    serverTiming: [],
  });
  try {
    resources = [resource(1)];
    let stop = startDashboardCapture(queryClient, true, () => "getDashboardSummary");
    assert.equal(report().samples.length, 1);
    stop();
    stop = startDashboardCapture(queryClient, false, () => "getDashboardSummary");
    assert.equal(report().samples.length, 1);
    stop();
    timeOrigin += 1000;
    resources = [resource(2, 500)];
    status = "error";
    stop = startDashboardCapture(queryClient, true, () => "getDashboardSummary");
    assert.equal(report().samples.length, 2);
    assert.equal(report().samples[1].outcome, "failure");
    assert.equal(report().samples[1].queryOutcome, "failure");
    fetchStatus = "fetching";
    listeners.get("pagehide")();
    assert.equal(report().samples.at(-1).outcome, "interrupted");
    assert.equal(report().samples.at(-1).durationMs, null);
    stop();
    assert.equal(observerCount, 0);
    assert.equal(subscriptions, 0);
    assert.equal(listeners.size, 0);
    assert.equal(nodes.length, 0);
    saved.clear();
    resources = [resource(3)];
    fetchStatus = "idle";
    status = "success";
    stop = startDashboardCapture(queryClient, true, () => "getDashboardSummary");
    assert.equal(report().samples.length, 1, "a separate session has no earlier samples");
    stop();
    saved.clear();
    resources = Array.from({ length: 70 }, (_, index) => resource(index + 10));
    stop = startDashboardCapture(queryClient, true, () => "getDashboardSummary");
    assert.equal(report().samples.length, 60);
    assert.equal(report().capped, true);
    stop();
    saved.clear();
    location.search = "";
    stop = startDashboardCapture(queryClient, true, () => "getDashboardSummary");
    assert.equal(nodes.length, 0);
    stop();
  } finally {
    for (const [name, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
  }
});
