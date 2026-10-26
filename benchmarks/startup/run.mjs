import { chromium } from "playwright";
import { writeFile, readFile } from "node:fs/promises";
import { assertNewOutputs } from "./output.mjs";
const version = process.env.STARTUP_VERSION ?? "baseline",
  runs = Number(process.env.STARTUP_RUNS ?? 10);
if (
  !["baseline", "optimized"].includes(version) ||
  !Number.isInteger(runs) ||
  runs < 1 ||
  runs > 10
)
  throw Error("Choose baseline/optimized and between one and ten measured runs.");
const output =
  process.env.STARTUP_OUTPUT ??
  `docs/performance/startup-${process.env.STARTUP_CONFIRM === "1" ? "confirmation-" : process.env.STARTUP_SMOKE === "1" ? "smoke-" : ""}${version}.json`;
const resume = process.env.STARTUP_RESUME === "1";
if (resume && !process.env.STARTUP_OUTPUT)
  throw Error("Resume requires an explicit STARTUP_OUTPUT filename.");
if (!resume) assertNewOutputs([output]);
const productionPort = version === "baseline" ? 4190 : 4192,
  fixturePort = version === "baseline" ? 4191 : 4193;
const result = {
  version,
  browser: browser.version(),
  runs,
  profile: {
    mobile: { width: 390, latencyMs: 150, downloadBytesPerSecond: 200000, cpuSlowdown: 4 },
    desktop: { width: 1440, throttling: "none" },
  },
  protocol:
    "Production assets; actual homepage; real app shell/routes with synthetic auth and RPC adapters for dashboard. Cold=new context; warm=HTTP-cache reload; cached=client return. One discarded warmup per scenario. External fonts remain live and failures are retained.",
  results: [],
};
if (resume) {
  const previous = JSON.parse(await readFile(output, "utf8"));
  if (previous.version !== version || previous.runs !== runs || !Array.isArray(previous.results))
    throw Error("Resume output does not match this version/run count.");
  result.results.push(...previous.results);
}
if (!resume) await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const persist = () => writeFile(output, JSON.stringify(result, null, 2) + "\n");
async function context(profile) {
  const ctx = await browser.newContext({
    viewport: { width: profile === "mobile" ? 390 : 1440, height: 900 },
    timezoneId: "America/Los_Angeles",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  if (profile === "mobile") {
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: 200000,
      uploadThroughput: 93750,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  let metrics = {
    requests: 0,
    transferBytes: 0,
    javascriptBytes: 0,
    fixtureRequests: 0,
    failedRequests: 0,
    pageErrors: 0,
  };
  const types = new Map();
  cdp.on("Network.requestWillBeSent", (event) => {
    metrics.requests++;
    types.set(event.requestId, {
      type: event.type,
      fixture: event.request.url.includes("/__startup-fixture/"),
    });
    if (event.request.url.includes("/__startup-fixture/")) metrics.fixtureRequests++;
  });
  cdp.on("Network.loadingFinished", (event) => {
    metrics.transferBytes += event.encodedDataLength;
    if (types.get(event.requestId)?.type === "Script")
      metrics.javascriptBytes += event.encodedDataLength;
  });
  cdp.on("Network.loadingFailed", () => metrics.failedRequests++);
  page.on("pageerror", () => metrics.pageErrors++);
  await page.addInitScript(() => {
    const probe = (window.__startupProbe = {
      readyMs: null,
      summaryMs: null,
      lcpMs: null,
      cls: 0,
      phases: {},
      target: location.pathname,
    });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) probe.lcpMs = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) probe.cls += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
    const ready = () => {
      const onDashboard = location.pathname === "/dashboard";
      const button = document.querySelector(".club-menu-button");
      const homepage =
        location.pathname === "/" &&
        document.querySelector(".club-hero h1") &&
        document.querySelector('.club-hero-actions a[href="/scoreboard"]') &&
        button &&
        Object.keys(button).some((key) => key.startsWith("__reactProps"));
      if (
        probe.readyMs === null &&
        (probe.target === "/dashboard"
          ? onDashboard && document.querySelector('[data-dashboard-ready="true"]')
          : homepage)
      )
        probe.readyMs = performance.now();
      if (probe.summaryMs === null && document.querySelector('[data-dashboard-summary="ready"]'))
        probe.summaryMs = performance.now();
      requestAnimationFrame(ready);
    };
    requestAnimationFrame(ready);
  });
  return {
    ctx,
    page,
    reset() {
      metrics = {
        requests: 0,
        transferBytes: 0,
        javascriptBytes: 0,
        fixtureRequests: 0,
        failedRequests: 0,
        pageErrors: 0,
      };
    },
    metrics: () => ({ ...metrics }),
  };
}
async function readReady(h, kind, profile) {
  await h.page.waitForFunction(() => window.__startupProbe?.readyMs !== null);
  if (kind === "dashboard")
    await h.page.waitForFunction(() => window.__startupProbe?.summaryMs !== null);
  const ready = await h.page.evaluate(() => ({
    ...window.__startupProbe,
    ttfbMs: performance.getEntriesByType("navigation")[0]?.responseStart ?? null,
    resourcePhases: performance
      .getEntriesByType("resource")
      .filter((e) => e.name.includes("/__startup-fixture/") || e.name.endsWith(".js"))
      .map((e) => ({
        name: new URL(e.name).pathname.split("/").at(-1),
        startMs: e.startTime,
        endMs: e.responseEnd,
        durationMs: e.duration,
        transferBytes: e.transferSize,
      })),
  }));
  if (kind === "homepage" && profile === "mobile") {
    await h.page.getByRole("button", { name: "Open website menu", exact: true }).click();
    await h.page
      .getByRole("navigation", { name: "Mobile website navigation" })
      .waitFor({ state: "visible" });
    await h.page.getByRole("button", { name: "Close website menu", exact: true }).click();
  }
  await h.page.waitForLoadState("networkidle");
  return {
    ...ready,
    ...(await h.page.evaluate(() => ({
      lcpMs: window.__startupProbe.lcpMs,
      cls: window.__startupProbe.cls,
    }))),
    ...h.metrics(),
  };
}
try {
  for (const profile of ["mobile", "desktop"])
    for (const spec of [
      { kind: "homepage", scenario: "cold" },
      { kind: "homepage", scenario: "warm" },
      ...[0, 20, 100].flatMap((count) => [
        { kind: "dashboard", scenario: "cold", count },
        { kind: "dashboard", scenario: "cached", count },
      ]),
    ]) {
      if (
        process.env.STARTUP_CONFIRM === "1" &&
        !(profile === "mobile" && spec.kind === "homepage" && spec.scenario === "cold")
      )
        continue;
      if (
        result.results.some(
          (x) =>
            x.profile === profile &&
            x.kind === spec.kind &&
            x.scenario === spec.scenario &&
            x.count === spec.count,
        )
      )
        continue;
      if (
        process.env.STARTUP_SMOKE === "1" &&
        !(
          profile === "mobile" &&
          spec.scenario === "cold" &&
          (spec.kind === "homepage" || spec.count === 20)
        )
      )
        continue;
      const url = `http://127.0.0.1:${spec.kind === "homepage" ? productionPort : fixturePort}/${spec.kind === "homepage" ? "" : `dashboard?count=${spec.count}`}`;
      const samples = [];
      let warmup;
      let retained;
      if (spec.scenario !== "cold") {
        retained = await context(profile);
        await retained.page.goto(url);
        await readReady(retained, spec.kind, profile);
      }
      for (let i = -1; i < runs; i++) {
        const h = retained ?? (await context(profile));
        h.reset();
        let sample;
        try {
          if (spec.scenario === "cached") {
            const rules = h.page.getByRole("link", { name: "Rules", exact: true });
            if (!(await rules.isVisible()))
              await h.page.getByRole("button", { name: "More", exact: true }).click();
            await rules.click();
            await h.page.waitForURL("**/rules");
            await h.page.waitForLoadState("networkidle");
            h.reset();
            await h.page.evaluate(() => {
              window.__startupProbe.target = "/dashboard";
              window.__startupProbe.readyMs = null;
              window.__startupProbe.summaryMs = null;
              window.__startupProbe.returnStarted = performance.now();
            });
            await h.page.getByRole("link", { name: "Home", exact: true }).first().click();
            sample = await readReady(h, spec.kind, profile);
            const started = await h.page.evaluate(() => window.__startupProbe.returnStarted);
            sample.readyMs -= started;
            sample.summaryMs -= started;
            sample.lcpMs = null;
            sample.cls = null;
          } else {
            if (retained) await h.page.reload();
            else await h.page.goto(url);
            sample = await readReady(h, spec.kind, profile);
          }
        } catch (error) {
          sample = { ...h.metrics(), failure: true, errorType: error.name };
          console.log(
            "Scenario failed",
            profile,
            spec.kind,
            spec.scenario,
            spec.count ?? "",
            error.name,
            error.message.slice(0, 350),
          );
        }
        if (i >= 0) samples.push(sample);
        else warmup = sample;
        if (!retained) await h.ctx.close();
      }
      if (retained) await retained.ctx.close();
      result.results.push({ profile, ...spec, warmup, samples });
      await persist();
      console.log(
        "Completed",
        version,
        profile,
        spec.kind,
        spec.count ?? "",
        spec.scenario,
        samples.length,
      );
    }
} finally {
  await persist();
  await browser.close();
}
