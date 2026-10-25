// Automated regressions against a normal build and a synthetic collector page.
// Uses an empty browser context, synthetic storage, and no external requests.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createStartupServer } from "./server.mjs";

const output = process.argv[2];
const protectedOnly = process.argv.includes("--protected-only");
const authRoutesOnly = process.argv.includes("--auth-routes-only");
if (!output || existsSync(output)) throw Error("Choose a new verification output filename");
const result = { synthetic: true, accountAccess: false, checks: [], passed: false };
const key = "shuttleboard.startup-measure.v1";
const trial = "shuttleboard.scoreboard-trial.v1";
const hook = await readFile(new URL("./measure-client.js", import.meta.url), "utf8");
const app = await createStartupServer({
  root: resolve(".output"),
  measurementAvailable: false,
  fixtures: false,
});
const synthetic = createServer((_req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(`<!doctype html><html><head><script data-build="baseline" data-fingerprint="synthetic">${hook}</script></head>
    <body><a href="/history">History</a><a href="/dashboard">Dashboard</a><main></main>
    <script>
      const render=()=>document.querySelector('main').innerHTML=location.pathname==='/dashboard'
        ? '<div data-dashboard-ready="true" data-dashboard-summary="ready">Ready</div>' : 'History';
      document.addEventListener('click',e=>{const a=e.target.closest('a');if(!a)return;e.preventDefault();history.pushState({},'',a.pathname);render();});
      if(sessionStorage.getItem('synthetic.ready')) render();
    </script></body></html>`);
});
let browser;
async function listen(server) {
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${server.address().port}`;
}
async function check(name, run) {
  try {
    await run();
    result.checks.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    result.checks.push({ name, passed: false, error: error.message });
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
try {
  const origin = await listen(app.server),
    syntheticOrigin = await listen(synthetic);
  browser = await chromium.launch({ channel: "msedge", headless: true });
  result.browser = browser.version();
  const sdkFile = (await readdir(".output/public/assets")).find(
    (name) => name.startsWith("supabase-client-") && name.endsWith(".js"),
  );
  assert.ok(sdkFile);
  const sdkSource = await readFile(resolve(".output/public/assets", sdkFile), "utf8");
  const exportBlock = /export\s*\{([^}]+)\};?\s*$/;
  const bindings = sdkSource
    .match(exportBlock)?.[1]
    .split(",")
    .map((binding) => {
      const match = binding.trim().match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/);
      assert.ok(match, "Expected named SDK exports");
      return { local: match[1], exported: match[2] ?? match[1] };
    });
  assert.ok(bindings?.length, "Expected SDK exports in the normal build");
  // Keep real exports and initialization intact. Only a factory returning an auth
  // client is wrapped, so this fails subscription setup rather than module import.
  const subscriptionFailureSource = sdkSource.replace(
    exportBlock,
    `
    const __syntheticWrap = factory => typeof factory === 'function' ? new Proxy(factory, {
      apply(target, self, args) {
        const client = Reflect.apply(target, self, args);
        if(client?.auth?.onAuthStateChange) client.auth.onAuthStateChange = () => {
          globalThis.__syntheticSubscriptionFailures = (globalThis.__syntheticSubscriptionFailures || 0) + 1;
          throw new Error('Synthetic subscription setup failure');
        };
        return client;
      }
    }) : factory;
    ${bindings.map(({ local }, i) => `const __syntheticExport${i} = __syntheticWrap(${local});`).join("\n")}
    export {${bindings.map(({ exported }, i) => `__syntheticExport${i} as ${exported}`).join(",")}};
  `,
  );
  for (const failure of protectedOnly ? ["import"] : ["import", "subscription"]) {
    for (const path of authRoutesOnly
      ? ["/auth", "/settings", "/reset-password"]
      : protectedOnly
        ? ["/dashboard"]
        : [
            "/scoreboard",
            "/",
            "/rules",
            "/p/synthetic",
            "/auth",
            "/settings",
            "/reset-password",
            ...(failure === "import" ? ["/dashboard"] : []),
          ]) {
      await check(`${failure} failure on ${path} shows Reload and preserves storage`, async () => {
        const context = await browser.newContext();
        try {
          let failing = true,
            profileRequests = 0;
          await context.route("**/*", async (route) => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) return route.abort();
            if (url.pathname.endsWith("/" + sdkFile) && failing) {
              if (failure === "import") return route.abort();
              return route.fulfill({
                contentType: "text/javascript",
                body: subscriptionFailureSource,
              });
            }
            if (url.pathname.includes("/_serverFn/")) {
              profileRequests++;
              return route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({ result: { unavailable: true, handle: "synthetic" } }),
              });
            }
            return route.continue();
          });
          await context.addInitScript(() => {
            if (sessionStorage.getItem("synthetic.seeded")) return;
            sessionStorage.setItem("synthetic.seeded", "yes");
            localStorage.setItem("synthetic.login", "preserved");
            localStorage.setItem("shuttleboard.pending-invite", "synthetic");
            localStorage.setItem("synthetic.preferences", "preserved");
            sessionStorage.setItem("synthetic.draft", "preserved");
          });
          const page = await context.newPage();
          await page.goto(origin + path);
          await page
            .getByRole("button", { name: "Reload", exact: true })
            .waitFor({ timeout: authRoutesOnly ? 5000 : 30000 });
          if (failure === "subscription")
            assert.ok(
              await page.evaluate(() => globalThis.__syntheticSubscriptionFailures > 0),
              "The real client reached subscription setup",
            );
          assert.equal(await page.evaluate((k) => localStorage.getItem(k), trial), null);
          if (path === "/") assert.equal(await page.locator(".club-hero").isVisible(), true);
          if (path === "/rules") assert.equal(await page.locator("main h1").isVisible(), true);
          if (path.startsWith("/p/")) {
            await page.getByText("Profile card unavailable", { exact: true }).waitFor();
            assert.ok(profileRequests > 0, "Public data did not wait for authentication");
          }
          const before = await page.evaluate(() => ({
            login: localStorage.getItem("synthetic.login"),
            invite: localStorage.getItem("shuttleboard.pending-invite"),
            preferences: localStorage.getItem("synthetic.preferences"),
            draft: sessionStorage.getItem("synthetic.draft"),
          }));
          failing = false;
          await Promise.all([
            page.waitForEvent("domcontentloaded"),
            page.getByRole("button", { name: "Reload", exact: true }).click(),
          ]);
          await page
            .getByRole("button", { name: "Reload", exact: true })
            .waitFor({ state: "hidden" });
          if (path === "/dashboard") await page.waitForURL(origin + "/auth");
          else assert.equal(new URL(page.url()).pathname, path);
          if (path === "/scoreboard")
            await page.waitForFunction((k) => localStorage.getItem(k) === "used", trial);
          assert.deepEqual(
            await page.evaluate(() => ({
              login: localStorage.getItem("synthetic.login"),
              invite: localStorage.getItem("shuttleboard.pending-invite"),
              preferences: localStorage.getItem("synthetic.preferences"),
              draft: sessionStorage.getItem("synthetic.draft"),
            })),
            before,
          );
        } finally {
          await context.close();
        }
      });
    }
  }
  if (!protectedOnly && !authRoutesOnly)
    await check(
      "preparation timeout exposes export and a successful retry retains records and caps",
      async () => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await page.addInitScript(
            ({ key }) => {
              if (sessionStorage.getItem(key)) return;
              sessionStorage.setItem(
                key,
                JSON.stringify({
                  protocol: 3,
                  samples: [],
                  session: { id: "synthetic-session", startedAt: Date.now(), navigations: 4 },
                  run: {
                    id: "failed-preparation",
                    kind: "cached-return",
                    index: 0,
                    preparing: true,
                  },
                }),
              );
            },
            { key },
          );
          await page.goto(syntheticOrigin + "/dashboard");
          await page.waitForFunction(
            (k) => JSON.parse(sessionStorage.getItem(k)).stopReason === "timeout",
            key,
            { timeout: 35000 },
          );
          await page.getByRole("button", { name: "Export measurements", exact: true }).waitFor();
          const failed = await page.evaluate((k) => JSON.parse(sessionStorage.getItem(k)), key);
          assert.equal(failed.run, undefined);
          assert.equal(failed.batches.at(-1).status, "timeout");
          assert.equal(failed.samples[0].scheduled, false);
          const exported = JSON.parse(
            await page.getByRole("textbox", { name: "Measurement export" }).inputValue(),
          );
          assert.equal(exported.samples[0].classification, "timeout");
          result.collectorFailure = exported;
          await page.evaluate(() => sessionStorage.setItem("synthetic.ready", "yes"));
          await page.getByRole("button", { name: "Measure cached-return", exact: true }).click();
          await page.waitForFunction(
            (k) => JSON.parse(sessionStorage.getItem(k)).stopReason === "complete",
            key,
            { timeout: 30000 },
          );
          const complete = await page.evaluate((k) => JSON.parse(sessionStorage.getItem(k)), key);
          assert.equal(complete.session.startedAt, failed.session.startedAt);
          assert.equal(complete.session.id, failed.session.id);
          assert.equal(complete.session.navigations, 17);
          assert.equal(complete.samples[0].classification, "timeout");
          assert.equal(
            complete.samples.filter(
              (s) => s.scheduled && s.classification === "complete" && !s.warmup,
            ).length,
            10,
          );
          assert.notEqual(complete.batches.at(-1).id, "failed-preparation");
          result.collectorCompleted = { samples: complete.samples, batches: complete.batches };
        } finally {
          await context.close();
        }
      },
    );
  result.passed = result.checks.every((check) => check.passed);
} catch (error) {
  result.checks.push({ name: "test setup", passed: false, error: error.message });
} finally {
  await browser?.close();
  await app.close();
  synthetic.closeAllConnections();
  await new Promise((done) => synthetic.close(done));
  await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
}
if (!result.passed) process.exitCode = 1;
