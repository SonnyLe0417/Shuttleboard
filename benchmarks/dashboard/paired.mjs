import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
const runs = 10,
  versions = ["baseline", "optimized"],
  reports = {};
async function run(args, env) {
  const child = spawn(process.execPath, args, { env, stdio: "inherit" });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`Command failed (${code})`);
}
for (const version of versions) {
  if (process.env.BENCHMARK_SKIP_BUILD !== "1")
    await run(
      [
        "node_modules/vite/bin/vite.js",
        "build",
        "--config",
        "benchmarks/dashboard/vite.config.mjs",
      ],
      { ...process.env, DASHBOARD_BENCHMARK_VERSION: version },
    );
  reports[version] = {
    version,
    runs,
    protocol:
      "paired-v3: native performance/rAF/timers, fixed Date only; interleaved versions; paint marks; explicit query/router settlement; details pre-scrolled",
    network: {
      mobile: { latencyMs: 150, downloadMbps: 1.6, cpuSlowdown: 4 },
      desktop: "unthrottled",
    },
    results: [],
  };
}
const servers = [];
for (const [index, version] of versions.entries()) {
  const server = spawn(process.execPath, ["benchmarks/dashboard/server.mjs"], {
    env: {
      ...process.env,
      DASHBOARD_BENCHMARK_VERSION: version,
      BENCHMARK_PORT: String(4180 + index),
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  servers.push(server);
  await Promise.race([
    once(server.stdout, "data"),
    once(server, "exit").then(() => {
      throw new Error("A fixture server could not start. Check ports 4180 and 4181.");
    }),
  ]);
}
const browser = await chromium.launch({ channel: "msedge", headless: true });
async function setup(profile, count, version) {
  const context = await browser.newContext({
    viewport: { width: profile === "mobile" ? 390 : 1440, height: 900 },
    timezoneId: "America/Los_Angeles",
  });
  const page = await context.newPage();
  context.setDefaultTimeout(30_000);
  // Freeze calendar calculations only; measurement clocks and timers remain native.
  await context.addInitScript(() => {
    const NativeDate = Date,
      fixed = NativeDate.parse("2026-10-19T12:00:00Z");
    function BenchmarkDate(...args) {
      if (new.target) return new NativeDate(...(args.length ? args : [fixed]));
      return new NativeDate(fixed).toString();
    }
    BenchmarkDate.prototype = NativeDate.prototype;
    Object.setPrototypeOf(BenchmarkDate, NativeDate);
    BenchmarkDate.now = () => fixed;
    window.Date = BenchmarkDate;
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  if (profile === "mobile") {
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: 200000,
      uploadThroughput: 93750,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  const metrics = { requests: 0, responseBytes: 0, javascriptBytes: 0, lastDataEnd: 0 };
  const pending = new Set();
  page.on("response", (response) => {
    const task = (async () => {
      try {
        const bytes = (await response.body()).length;
        if (response.url().includes("/__fixture/")) {
          metrics.requests++;
          metrics.responseBytes += bytes;
          metrics.lastDataEnd = performance.now();
        }
        if (response.request().resourceType() === "script") metrics.javascriptBytes += bytes;
      } catch {}
    })();
    pending.add(task);
    task.finally(() => pending.delete(task));
  });
  const settle = async () => {
    await page.waitForFunction(
      () =>
        window.benchmark &&
        !window.benchmark.router.state.isLoading &&
        window.benchmark.queryClient.isFetching() === 0,
    );
    await Promise.all([...pending]);
  };
  const ready = async () => {
    try {
      await page.waitForFunction(
        () =>
          window.benchmark?.marks.readyMs !== undefined &&
          window.benchmark?.marks.summaryReadyMs !== undefined,
        undefined,
        { timeout: 30_000 },
      );
    } catch (error) {
      console.error(
        "Readiness diagnostic",
        await page.evaluate(() => ({
          marks: window.benchmark?.marks,
          queries: window.benchmark?.queryClient
            .getQueryCache()
            .getAll()
            .map((query) => ({
              key: query.queryKey,
              status: query.state.status,
              hasData: query.state.data !== undefined,
            })),
          body: document.body.innerText.slice(0, 1800),
        })),
      );
      throw error;
    }
  };
  return {
    context,
    page,
    metrics,
    ready,
    settle,
    url: `http://127.0.0.1:${version === "baseline" ? 4180 : 4181}/dashboard?count=${count}`,
  };
}
async function persist() {
  for (const version of versions) {
    reports[version].browser = browser.version();
    reports[version].capturedAt = new Date().toISOString();
    await writeFile(
      `docs/performance/dashboard-${version}.json`,
      JSON.stringify(reports[version], null, 2) + "\n",
    );
  }
}
try {
  for (const profile of ["mobile", "desktop"])
    for (const count of [0, 20, 100])
      for (const scenario of ["cold", "cached", "stale", "details"]) {
        const samples = { baseline: [], optimized: [] },
          handles = {};
        if (scenario !== "cold")
          for (const version of versions) {
            const h = await setup(profile, count, version);
            handles[version] = h;
            await h.page.goto(h.url);
            await h.ready();
            await h.settle();
          }
        for (let repeat = -1; repeat < runs; repeat++)
          for (const version of repeat % 2 === 0 ? [...versions].reverse() : versions) {
            const h = scenario === "cold" ? await setup(profile, count, version) : handles[version];
            const { page, metrics, ready, settle } = h;
            await page.bringToFront();
            if (repeat === -1) console.log(`Warm-up ${profile} ${count} ${scenario} ${version}`);
            if (scenario !== "cold") {
              await page.getByRole("link", { name: "Away", exact: true }).click();
              await page.getByText("Return to your dashboard.", { exact: true }).waitFor();
              if (scenario === "stale") await page.evaluate(() => window.benchmark.age());
              if (scenario === "details") {
                await page.evaluate(() => {
                  window.benchmark.queryClient.removeQueries({ queryKey: ["progress"] });
                  window.benchmark.queryClient.removeQueries({ queryKey: ["me", "preferences"] });
                });
                await page.getByRole("link", { name: "Dashboard", exact: true }).click();
                await settle();
                await page.locator("summary").scrollIntoViewIfNeeded();
              }
              await page.evaluate((mode) => window.benchmark.begin(mode), scenario);
            }
            Object.assign(metrics, {
              requests: 0,
              responseBytes: 0,
              javascriptBytes: 0,
              lastDataEnd: 0,
            });
            const start = performance.now();
            if (scenario === "cold") await page.goto(h.url);
            else if (scenario === "details") await page.locator("summary").click();
            else await page.getByRole("link", { name: "Dashboard", exact: true }).click();
            await ready();
            await settle();
            const marks = await page.evaluate(() => window.benchmark.marks);
            if (scenario === "stale") {
              const expected = version === "baseline" ? 1 : 2;
              if (metrics.requests !== expected)
                throw new Error(
                  `${version} stale return expected ${expected} requests; observed ${metrics.requests}.`,
                );
            }
            if (repeat >= 0)
              samples[version].push({
                readyMs: marks.readyMs,
                summaryReadyMs: marks.summaryReadyMs,
                dataReadyMs: marks.dataReadyMs ?? null,
                completeMs: Math.max(marks.summaryReadyMs, metrics.lastDataEnd - start),
                requests: metrics.requests,
                responseBytes: metrics.responseBytes,
                javascriptBytes: metrics.javascriptBytes,
              });
            if (repeat === 0 || repeat === 4 || repeat === 9)
              console.log(
                `Sample ${profile} ${count} ${scenario} ${version} ${repeat + 1}/${runs}: ${Math.round(marks.readyMs)} ms`,
              );
            if (scenario === "cold") await h.context.close();
          }
        for (const version of versions) {
          if (scenario !== "cold") await handles[version].context.close();
          const values = samples[version],
            p = (key, fraction) => {
              const sorted = values
                .map((row) => row[key])
                .filter((value) => value !== null)
                .sort((a, b) => a - b);
              if (fraction === 0.5 && sorted.length % 2 === 0)
                return (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
              return sorted[Math.ceil(sorted.length * fraction) - 1];
            };
          reports[version].results.push({
            profile,
            count,
            scenario,
            runs,
            samples: values,
            medianReadyMs: p("readyMs", 0.5),
            p90ReadyMs: p("readyMs", 0.9),
            medianSummaryReadyMs: p("summaryReadyMs", 0.5),
            medianDataReadyMs: scenario === "cached" ? null : p("dataReadyMs", 0.5),
            medianCompleteMs: p("completeMs", 0.5),
            medianRequests: p("requests", 0.5),
            medianResponseBytes: p("responseBytes", 0.5),
            medianJavascriptBytes: p("javascriptBytes", 0.5),
          });
        }
        await persist();
        console.log(
          `${profile} ${count} ${scenario}: ${Math.round(reports.baseline.results.at(-1).medianReadyMs)} → ${Math.round(reports.optimized.results.at(-1).medianReadyMs)} ms`,
        );
      }
} finally {
  await browser.close();
  for (const server of servers) server.kill();
}
