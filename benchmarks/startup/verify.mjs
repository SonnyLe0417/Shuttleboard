import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { assertNewOutputs } from "./output.mjs";
import assert from "node:assert/strict";
import { loadEnv } from "vite";
const output = process.argv[2] ?? "docs/performance/startup-interactions.json";
assertNewOutputs([output]);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const checks = [];
async function check(name, body) {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.name));
  try {
    await body(page, context);
    assert.equal(errors.length, 0, "No browser runtime/hydration errors");
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false, errorType: error.name });
    console.log("Verification failed", name, error.message.slice(0, 300));
  } finally {
    await context.close();
  }
}
async function rules(page) {
  const link = page.getByRole("link", { name: "Rules", exact: true });
  if (!(await link.isVisible()))
    await page.getByRole("button", { name: "More", exact: true }).click();
  await link.click();
  await page.waitForURL("**/rules");
}
try {
  await check("production phone menu and real badminton deuce example", async (page) => {
    await page.goto("http://127.0.0.1:4192/");
    await page.getByRole("button", { name: "Open website menu", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Mobile website navigation" })
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Close website menu", exact: true }).click();
    const theirs = page.getByRole("button", { name: "Add a point to their team", exact: true }),
      ours = page.getByRole("button", { name: "Add a point to your team", exact: true });
    for (let i = 0; i < 4; i++) await theirs.click();
    for (let i = 0; i < 3; i++) await ours.click();
    assert.equal(await ours.isEnabled(), true, "21–20 is not a winning badminton score");
    await ours.click();
    assert.equal(await theirs.isEnabled(), false, "22–20 ends the game");
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
  });
  await check(
    "production protected entry redirects signed-out visitors without hydration errors",
    async (page) => {
      await page.goto("http://127.0.0.1:4192/dashboard");
      await page.waitForURL("**/auth");
      await page
        .getByRole("heading", { name: "Welcome back", exact: true })
        .waitFor({ state: "visible" });
    },
  );
  await check("production anonymous scoring limit remains enforced", async (page, context) => {
    await context.addInitScript(() =>
      localStorage.setItem("shuttleboard.scoreboard-trial.v1", "used"),
    );
    await page.goto("http://127.0.0.1:4192/scoreboard");
    await page.getByRole("link", { name: /Create your account/ }).waitFor({ state: "visible" });
  });
  await check("onboarding blocks essential and summary requests", async (page) => {
    const requests = [];
    page.on("request", (request) => {
      if (request.url().includes("/__startup-fixture/"))
        requests.push(new URL(request.url()).pathname.split("/").at(-1));
    });
    await page.route("**/__startup-fixture/getOnboardingStatus*", (route) =>
      route.fulfill({ json: { onboarded: false } }),
    );
    await page.goto("http://127.0.0.1:4193/dashboard?count=20");
    await page.waitForURL("**/onboarding");
    assert.equal(requests.includes("getDashboardCore"), false);
    assert.equal(requests.includes("getDashboardSummary"), false);
  });
  await check(
    "expired synthetic session is rejected without protected requests",
    async (page, context) => {
      const env = loadEnv("production", process.cwd(), "");
      const project = new URL(env.VITE_SUPABASE_URL ?? env.SUPABASE_URL).hostname.split(".")[0];
      await context.addInitScript(
        (key) =>
          localStorage.setItem(
            key,
            JSON.stringify({
              access_token: "synthetic-expired-token",
              refresh_token: "synthetic-expired-refresh",
              expires_at: 1,
              token_type: "bearer",
              user: { id: "synthetic-expired-user" },
            }),
          ),
        `sb-${project}-auth-token`,
      );
      let protectedRequests = 0;
      page.on("request", (request) => {
        if (request.url().includes("/_serverFn/")) protectedRequests++;
      });
      await page.route(/\/auth\/v1\//, (route) =>
        route.fulfill({
          status: route.request().method() === "OPTIONS" ? 204 : 400,
          body:
            route.request().method() === "OPTIONS"
              ? ""
              : JSON.stringify({
                  code: "refresh_token_not_found",
                  msg: "Synthetic expired session",
                }),
          headers: {
            "content-type": "application/json",
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers":
              route.request().headers()["access-control-request-headers"] ?? "*",
          },
        }),
      );
      await page.goto("http://127.0.0.1:4192/dashboard");
      await page.waitForURL("**/auth");
      assert.equal(protectedRequests, 0);
    },
  );
  await check(
    "pending invitation navigation is stable after session initialization",
    async (page, context) => {
      await context.addInitScript(() =>
        localStorage.setItem("shuttleboard.pending-invite", "startup-synthetic-invite"),
      );
      await page.route("**/__startup-fixture/getInviteByToken*", (route) =>
        route.fulfill({ json: { unavailable: true } }),
      );
      await page.goto("http://127.0.0.1:4193/auth");
      await page.waitForURL("**/invite/startup-synthetic-invite");
      await page
        .getByRole("heading", { name: "Invitation unavailable", exact: true })
        .waitFor({ state: "visible" });
      await page.waitForLoadState("networkidle");
      assert.equal(new URL(page.url()).pathname, "/invite/startup-synthetic-invite");
    },
  );
  await check(
    "saved goal, active-match action and analysis polling survive navigation",
    async (page, context) => {
      let polls = 0,
        cancels = 0;
      await context.addInitScript(() => {
        localStorage.setItem(
          "shuttleboard.match-draft.v1",
          JSON.stringify({ matchStartedAt: Date.now(), matchOver: false }),
        );
        localStorage.setItem(
          "shuttleboard.tracknet-analysis",
          JSON.stringify({
            jobId: "startup-synthetic-job",
            fileName: "Example video.webm",
            startedAt: Date.now(),
          }),
        );
      });
      await page.route("**/jobs/startup-synthetic-job", (route) => {
        if (route.request().method() === "DELETE") cancels++;
        else polls++;
        return route.fulfill({
          json: {
            job_id: "startup-synthetic-job",
            status: "processing",
            progress: 0.4,
            eta_seconds: 20,
          },
          headers: { "access-control-allow-origin": "*" },
        });
      });
      await page.goto("http://127.0.0.1:4193/dashboard?count=20");
      await page
        .getByRole("link", { name: "Resume match", exact: true })
        .waitFor({ state: "visible" });
      await page
        .getByRole("heading", { name: "Play twice this week", exact: true })
        .waitFor({ state: "visible" });
      const banner = page.getByText(/TrackNet is analyzing Example video.webm/);
      await banner.waitFor({ state: "visible" });
      await rules(page);
      await banner.waitFor({ state: "visible" });
      await page.waitForRequest(
        (request) =>
          request.url().endsWith("/jobs/startup-synthetic-job") && request.method() === "GET",
      );
      await page.getByRole("link", { name: "Home", exact: true }).click();
      await page
        .getByRole("link", { name: "Resume match", exact: true })
        .waitFor({ state: "visible" });
      assert.ok(polls >= 2);
      assert.equal(cancels, 0);
    },
  );
} finally {
  await browser.close();
  await writeFile(output, JSON.stringify({ syntheticAccountTests: true, checks }, null, 2) + "\n", {
    flag: "wx",
  });
}
if (checks.some((check) => !check.passed)) process.exitCode = 1;
console.log(checks);
