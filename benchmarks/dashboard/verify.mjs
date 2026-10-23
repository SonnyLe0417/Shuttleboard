import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { response } from "./fixtures.mjs";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const checks = [];
const url = "http://127.0.0.1:4180/dashboard?count=20";
try {
  for (const layout of ["compact", "balanced", "stats-heavy"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } }),
      page = await context.newPage();
    const counts = { core: 0, summary: 0, progress: 0, save: 0 };
    let failCore = false,
      failSummary = false,
      failSave = true;
    let goal = { title: "Saved custom practice goal", target: 3, progress: 0, unit: "sessions" };
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let delay = layout === "compact";
    await page.route("**/__fixture/*", async (route) => {
      const name = new URL(route.request().url()).pathname.split("/").at(-1);
      counts[name] = (counts[name] ?? 0) + 1;
      if (name === "summary" && delay) await gate;
      if (
        (name === "core" && failCore) ||
        (name === "summary" && failSummary) ||
        (name === "save" && failSave)
      ) {
        await route.fulfill({ status: 503, body: "unavailable" });
        return;
      }
      const input = route.request().postDataJSON();
      if (name === "save") {
        assert.deepEqual(Object.keys(input.data), ["dashboard"]);
        assert.deepEqual(Object.keys(input.data.dashboard), ["goal"]);
        goal = input.data.dashboard.goal;
      }
      const data = response("optimized", name, 20, input);
      if (name === "core") {
        data.dashboard = { ...data.dashboard, layout, goal };
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    });
    await page.goto(url);
    await page.locator('[data-dashboard-ready="true"]').waitFor();
    assert.equal(counts.core, 1);
    assert.equal(counts.summary, 1);
    if (layout === "compact") {
      assert.equal(await page.locator('[data-dashboard-summary="pending"]').count(), 1);
      assert.equal(await page.getByText("350", { exact: true }).count(), 0);
      await page.locator("summary").click();
      await page.getByRole("button", { name: "Edit goal" }).click();
      assert.equal(await page.getByLabel("Goal title").inputValue(), goal.title);
      await page.getByLabel("Goal title").fill("Unsaved practice draft");
      await page.evaluate(() => {
        const client = window.benchmark.queryClient;
        client.setQueryData(["dashboard", "core"], (old) => ({
          ...old,
          dashboard: {
            ...old.dashboard,
            goal: { ...old.dashboard.goal, title: "Background goal update" },
          },
        }));
      });
      assert.equal(await page.getByLabel("Goal title").inputValue(), "Unsaved practice draft");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Fixture save unavailable" }).waitFor();
      assert.equal(await page.getByLabel("Goal title").inputValue(), "Unsaved practice draft");
      failSave = false;
      await page.getByRole("button", { name: "Save", exact: true }).click();
      delay = false;
      release();
      await page.getByLabel("Goal title").waitFor({ state: "hidden" });
      await page
        .getByRole("heading", { name: "Unsaved practice draft", exact: true })
        .first()
        .waitFor();
      checks.push(
        "Essentials survive a pending summary; saved goal loads; background refresh and failed save preserve the draft; save sends a goal-only patch.",
      );
    }
    await page.locator('[data-dashboard-summary="ready"]').waitFor();
    if (layout === "stats-heavy") assert.equal(await page.locator("details[open]").count(), 1);
    else if (layout === "balanced") assert.equal(await page.locator("details[open]").count(), 0);
    await page.waitForLoadState("networkidle");
    const before = { ...counts };
    await page.getByRole("link", { name: "Away", exact: true }).click();
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await page.locator('[data-dashboard-ready="true"]').waitFor();
    await page.waitForLoadState("networkidle");
    assert.equal(counts.core, before.core);
    assert.equal(counts.summary, before.summary);
    await page.getByRole("link", { name: "Away", exact: true }).click();
    await page.evaluate(() => window.benchmark.age());
    failCore = true;
    failSummary = true;
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await page
      .getByText("Your dashboard could not refresh. Showing saved data.", { exact: true })
      .waitFor();
    await page
      .getByText("Progress could not refresh. Showing saved data.", { exact: true })
      .waitFor();
    assert.equal(await page.locator('[data-dashboard-ready="true"]').count(), 1);
    assert.equal(await page.getByText("350", { exact: true }).count(), 1);
    failCore = false;
    failSummary = false;
    await page
      .getByRole("alert")
      .filter({ hasText: "Your dashboard could not refresh." })
      .getByRole("button", { name: "Try again" })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Progress could not refresh." })
      .getByRole("button", { name: "Try again" })
      .click();
    await page
      .getByText("Progress could not refresh. Showing saved data.", { exact: true })
      .waitFor({ state: "hidden" });
    checks.push(
      `${layout}: cached return makes no duplicate requests; stale failures retain values; each section retries independently.`,
    );
    if (layout === "balanced") {
      await mkdir("docs/performance", { recursive: true });
      await page.screenshot({
        path: "docs/performance/dashboard-fixture-phone.png",
        fullPage: false,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({
        path: "docs/performance/dashboard-fixture-desktop.png",
        fullPage: false,
      });
    }
    await context.close();
  }
  for (const failedSection of ["core", "summary"]) {
    const context = await browser.newContext({ viewport: { width: 360, height: 900 } });
    const page = await context.newPage();
    let fail = true;
    await page.route(`**/__fixture/${failedSection}?*`, async (route) => {
      if (fail) await route.fulfill({ status: 503, body: "unavailable" });
      else await route.continue();
    });
    await page.goto(url);
    if (failedSection === "core") {
      await page.getByRole("heading", { name: "We could not load your court view." }).waitFor();
    } else {
      await page.locator('[data-dashboard-ready="true"]').waitFor();
      await page.getByRole("alert").filter({ hasText: "Your progress could not load." }).waitFor();
      assert.equal(await page.getByText("350", { exact: true }).count(), 0);
    }
    fail = false;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.locator('[data-dashboard-summary="ready"]').waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    checks.push(
      `${failedSection}: first-load failure is explicit, retry recovers, and the 360px layout fits.`,
    );
    await context.close();
  }
  const emptyContext = await browser.newContext();
  const emptyPage = await emptyContext.newPage();
  await emptyPage.goto("http://127.0.0.1:4180/dashboard?count=0");
  await emptyPage.getByRole("heading", { name: "Your first game starts here." }).waitFor();
  await emptyPage.locator('[data-dashboard-summary="ready"]').waitFor();
  assert.equal(await emptyPage.locator(".club-match-row").count(), 0);
  checks.push("An empty account renders its real empty state with no fabricated recent matches.");
  await emptyContext.close();
  await writeFile(
    "docs/performance/dashboard-interactions.json",
    JSON.stringify({ passed: checks.length, checks }, null, 2) + "\n",
  );
  console.log(checks.join("\n"));
} finally {
  await browser.close();
}
