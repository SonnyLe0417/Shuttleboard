// Isolated collector integration checks. No app build, account or credentials.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, dirname, basename } from "node:path";
import { chromium } from "playwright";

const key = "shuttleboard.startup-measure.v1";
const hook = await readFile(new URL("./measure-client.js", import.meta.url), "utf8");
const output = process.argv[2] ?? "docs/performance/startup-collector-browser-verification.json";
const visibilityOnly = process.argv.includes("--visibility-only");
const manualVisibility = process.argv.includes("--manual-visibility");
if (existsSync(output)) throw new Error("Verification output exists; choose a new filename");
const result = {
  synthetic: true,
  accountAccess: false,
  scope: visibilityOnly ? "visibility-only" : "full",
  manualVisibility,
  checks: [],
  samples: [],
  passed: false,
};
const server = createServer((req, res) => {
  if (req.url === "/visibility-start") {
    res.setHeader("content-type", "text/html");
    return res.end(`<!doctype html><title>ShuttleBoard visibility test</title>
      <h1>ShuttleBoard synthetic visibility check</h1>
      <p>No account or production data. Click Start check, immediately minimize this Edge window,
      wait two seconds, then restore it. Keep Edge in front until this window closes;
      return to your terminal only afterward. The check will finish automatically.</p>
      <button onclick="location.href='/dashboard?delay=15000'">Start check</button>`);
  }
  if (req.url === "/blank") return res.end("<!doctype html><title>Visibility test tab</title>");
  res.setHeader("content-type", "text/html");
  res.setHeader("cache-control", "no-store");
  res.end(`<!doctype html><html><head><title>Synthetic collector check</title>
  <script>
    document.addEventListener('visibilitychange', event => {
      const events = JSON.parse(sessionStorage.getItem('synthetic.visibility') || '[]');
      events.push({state:document.visibilityState, trusted:event.isTrusted});
      sessionStorage.setItem('synthetic.visibility', JSON.stringify(events));
    });
    function outgoingProbe(phase) {
      const counts = JSON.parse(sessionStorage.getItem('synthetic.lifecycle') || '{}');
      counts[phase] = (counts[phase] || 0) + 1;
      sessionStorage.setItem('synthetic.lifecycle', JSON.stringify(counts));
      Object.defineProperty(document, 'visibilityState', {configurable:true, value:'hidden'});
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(window, 'innerWidth', {configurable:true, value:1});
      window.dispatchEvent(new Event('resize'));
    }
    addEventListener('beforeunload', () => outgoingProbe('beforePagehide'));
  </script>
  <script data-build="baseline" data-fingerprint="synthetic-fixed">${hook}</script>
  <script>addEventListener('pagehide', () => outgoingProbe('afterPagehide'));</script>
  </head><body><h1>Synthetic collector check — no account data</h1>
  <p>Keep this Edge window in front while automatic checks run. Do not minimize
  this page. A separate Start check page will tell you when to minimize and restore.</p>
  <a href="/history">History</a> <a href="/dashboard">Dashboard</a>
  <main></main>
  <script>
    const render = () => {
      document.querySelector('main').innerHTML = location.pathname === '/dashboard'
        ? '<div data-dashboard-ready="true" data-dashboard-summary="ready">Synthetic ready</div>'
        : '<div>Synthetic history</div>';
    };
    document.addEventListener('click', e => {
      const a = e.target.closest('a');
      if (!a) return;
      e.preventDefault(); history.pushState({}, '', a.getAttribute('href')); render();
    });
    setTimeout(render, Number(new URL(location.href).searchParams.get('delay') || 0));
  </script></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, browserProcess, profile;
const readState = (page) => page.evaluate((k) => JSON.parse(sessionStorage.getItem(k)), key);
async function waitState(page, predicate, timeout = 20000) {
  await page.waitForFunction(
    `(${predicate.toString()})(JSON.parse(sessionStorage.getItem('${key}')))`,
    null,
    { timeout, polling: 100 },
  );
  return readState(page);
}
async function scenario(name, fn) {
  if (visibilityOnly && !name.startsWith("genuine hidden")) return;
  const context = browser.contexts()[0];
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.bringToFront();
    page.setDefaultTimeout(15000);
    await fn(page, context);
    result.checks.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    result.checks.push({
      name,
      passed: false,
      error: error.message,
      state: await readState(page).catch(() => null),
      visibility: await page.evaluate(() => document.visibilityState).catch(() => null),
    });
    console.log(`FAIL ${name}: ${error.message}`);
  } finally {
    await page.close();
  }
}
async function seed(page, state) {
  await page.addInitScript(
    ({ key, state }) => {
      if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(state));
    },
    { key, state: { protocol: 3, samples: [], ...state } },
  );
}
try {
  // Use a separate empty profile, never the user's browser. The documented
  // noDefaults connection avoids Playwright's forced-visible focus override.
  profile = await mkdtemp(resolve(tmpdir(), "shuttleboard-collector-"));
  browserProcess = spawn(
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    [
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    // Show the separate test window so the operator can perform genuine hiding.
    { windowsHide: false, stdio: "ignore" },
  );
  let debugPort;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      debugPort = (await readFile(resolve(profile, "DevToolsActivePort"), "utf8")).split("\n")[0];
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(debugPort, "Isolated browser did not publish its debugging port");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { noDefaults: true });
  result.browser = browser.version();
  await scenario(
    "eleven automatic reloads with outgoing events before and after pagehide",
    async (page) => {
      await page.goto(`${origin}/dashboard`);
      await page.getByRole("button", { name: "Measure reload", exact: true }).click();
      const state = await waitState(page, (s) => s?.batches?.some((b) => b.status === "complete"));
      const eligible = state.samples.filter((s) => s.scheduled && s.classification === "complete");
      assert.equal(eligible.length, 11);
      assert.deepEqual(
        eligible.map((s) => s.sampleIndex),
        Array.from({ length: 11 }, (_, i) => i),
      );
      assert.equal(eligible.filter((s) => s.warmup).length, 1);
      assert.ok(eligible.every((s) => !s.backgrounded && !s.failures && !s.resourceErrors));
      const lifecycle = await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("synthetic.lifecycle")),
      );
      assert.equal(lifecycle.beforePagehide, 11);
      assert.equal(lifecycle.afterPagehide, 11);
      result.lifecycle = lifecycle;
      result.samples.push(...state.samples);
    },
  );
  await scenario("fresh preparation and eleven cached returns", async (page) => {
    await page.goto(`${origin}/dashboard`);
    await page.getByRole("button", { name: "Measure cached-return", exact: true }).click();
    const state = await waitState(page, (s) => s?.batches?.some((b) => b.status === "complete"));
    const returns = state.samples.filter((s) => s.scheduled && s.scenario === "cached-return");
    assert.equal(returns.length, 11);
    assert.ok(returns.every((s) => s.classification === "complete" && s.cacheWindowValid));
    assert.equal(returns.filter((s) => s.warmup).length, 1);
    assert.ok(state.samples.some((s) => s.batchId && s.scenario === "reload" && !s.scheduled));
    result.samples.push(...state.samples);
  });
  for (const kind of ["hidden", "resized"])
    await scenario(
      `genuine ${kind} document invalidates and requires explicit resume`,
      async (page, context) => {
        await seed(page, {
          viewport: { width: 1440, height: 900 },
          session: { id: "synthetic-session", startedAt: Date.now(), navigations: 0 },
          run: { id: "synthetic-batch", kind: "reload", index: 0 },
        });
        if (kind === "hidden" && manualVisibility) {
          await page.goto(`${origin}/visibility-start`);
          await page.bringToFront();
          console.log(
            "MANUAL VISIBILITY READY: click Start check in the synthetic Edge window, minimize for two seconds, then restore.",
          );
          await page.waitForURL("**/dashboard?delay=15000", {
            timeout: 180000,
            waitUntil: "domcontentloaded",
          });
        } else await page.goto(`${origin}/dashboard?delay=5000`);
        let cdp, windowId;
        if (kind === "hidden" && !manualVisibility) {
          cdp = await context.newCDPSession(page);
          // Playwright normally enables focus emulation, forcing visibility.
          // Disable that test-runner override before a real minimize event.
          await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false });
          ({ windowId } = await cdp.send("Browser.getWindowForTarget"));
          await cdp.send("Browser.setWindowBounds", {
            windowId,
            bounds: { windowState: "minimized" },
          });
          result.visibilityWindowBounds = await cdp.send("Browser.getWindowBounds", { windowId });
          await page.waitForFunction(() => document.visibilityState === "hidden", null, {
            polling: 100,
            timeout: 5000,
          });
          result.visibilityWindowBoundsAfter = await cdp.send("Browser.getWindowBounds", {
            windowId,
          });
        } else if (kind === "resized") await page.setViewportSize({ width: 1440, height: 800 });
        const interrupted = await waitState(page, (s) => s?.run?.paused === true);
        assert.equal(
          interrupted.samples.at(-1).classification,
          kind === "hidden" ? "backgrounded" : "viewport-changed",
        );
        assert.equal(interrupted.run.index, 0);
        if (kind === "hidden") {
          result.visibilityEvents = await page.evaluate(() =>
            JSON.parse(sessionStorage.getItem("synthetic.visibility") || "[]"),
          );
          assert.ok(
            result.visibilityEvents.some((event) => event.state === "hidden" && event.trusted),
            "A browser-generated hidden event is required",
          );
          if (cdp) {
            await cdp.send("Browser.setWindowBounds", {
              windowId,
              bounds: { windowState: "normal" },
            });
            await page.bringToFront();
          }
          await page.waitForFunction(() => document.visibilityState === "visible", null, {
            polling: 100,
            timeout: 30000,
          });
        } else await page.setViewportSize({ width: 1440, height: 900 });
        await page.waitForTimeout(1800);
        assert.equal((await readState(page)).session.navigations, 1);
        assert.equal((await readState(page)).run.paused, true);
        await page.getByRole("button", { name: "Resume visible run", exact: true }).click();
        await waitState(page, (s) => s?.session?.navigations >= 2);
        result.samples.push(...interrupted.samples);
      },
    );
  for (const cap of ["navigation", "elapsed time"])
    await scenario(`${cap} cap survives preparation and resume`, async (page) => {
      await seed(page, {
        session: {
          id: "capped-session",
          startedAt: Date.now() - (cap === "elapsed time" ? 1200001 : 0),
          navigations: cap === "navigation" ? 79 : 0,
        },
        run: {
          id: "capped-batch",
          kind: "cached-return",
          index: 2,
          paused: true,
          freshAt: Date.now(),
        },
      });
      await page.goto(`${origin}/dashboard`);
      await page.getByRole("button", { name: "Resume visible run", exact: true }).click();
      const state = await waitState(page, (s) => s?.stopReason === "limit-reached");
      assert.equal(state.session.navigations, cap === "navigation" ? 80 : 1);
      assert.equal(state.run, undefined);
    });
  await scenario(
    "expired cached batch retained and explicit resume starts new preparation",
    async (page) => {
      await seed(page, {
        session: { id: "expiry-session", startedAt: Date.now(), navigations: 0 },
        run: {
          id: "expired",
          kind: "cached-return",
          index: 2,
          paused: true,
          freshAt: Date.now() - 41000,
        },
      });
      await page.goto(`${origin}/dashboard`);
      await page.getByRole("button", { name: "Resume visible run", exact: true }).click();
      const state = await waitState(page, (s) => s?.batches?.some((b) => b.id === "expired"));
      assert.equal(state.batches.find((b) => b.id === "expired").status, "cache-window-expired");
      assert.notEqual(state.run.id, "expired");
      await waitState(page, (s) =>
        s?.samples?.some(
          (x) => x.batchId !== "expired" && x.batchId && x.scenario === "reload" && !x.scheduled,
        ),
      );
    },
  );
  result.passed = result.checks.every((check) => check.passed);
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  result.error = error.message;
  process.exitCode = 1;
} finally {
  if (browser) {
    const control = await browser.newBrowserCDPSession();
    await control.send("Browser.close").catch(() => {});
    await browser.close().catch(() => {});
  }
  browserProcess?.kill();
  if (
    profile &&
    dirname(resolve(profile)) === resolve(tmpdir()) &&
    basename(profile).startsWith("shuttleboard-collector-")
  )
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
      () => {},
    );
  await new Promise((resolve) => server.close(resolve));
  await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ passed: result.passed, checks: result.checks, output }));
}
