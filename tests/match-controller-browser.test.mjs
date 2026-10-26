import test from "node:test";
import assert from "node:assert/strict";
import { build } from "vite";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
test("real React Strict Mode batches voice commands, emits each effect once and restores the draft", async () => {
  const root = await mkdtemp(join(tmpdir(), "shuttleboard-score-"));
  let browser, server;
  try {
    await build({
      configFile: false,
      define: { "process.env.NODE_ENV": JSON.stringify("development") },
      resolve: { alias: { "@": resolve("src") } },
      build: {
        outDir: root,
        emptyOutDir: false,
        lib: {
          entry: resolve("tests/fixtures/match-controller-browser.mjs"),
          formats: ["es"],
          fileName: () => "score.js",
        },
        minify: false,
      },
      logLevel: "error",
    });
    const script = await readFile(join(root, "score.js"));
    server = createServer((req, res) => {
      res.setHeader("content-type", req.url === "/score.js" ? "text/javascript" : "text/html");
      res.end(
        req.url === "/score.js"
          ? script
          : '<!doctype html><html><body><div id="root"></div><script type="module" src="/score.js"></script></body></html>',
      );
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => localStorage.getItem("shuttleboard.match-draft.v1"));
    await page.getByRole("button", { name: "Two voice commands" }).click();
    await page.waitForFunction(() => document.querySelector("output").textContent === "2-0");
    assert.deepEqual(await page.evaluate(() => window.effects), { sound: 2, vibration: 2 });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("output").textContent === "1-0");
    await page.reload();
    await page.waitForFunction(() => document.querySelector("output")?.textContent === "1-0");
    assert.deepEqual(await page.evaluate(() => window.effects), { sound: 0, vibration: 0 });
    await page.getByRole("button", { name: "Two voice commands" }).click();
    await page.waitForFunction(() => document.querySelector("output").textContent === "3-0");
    assert.deepEqual(await page.evaluate(() => window.effects), { sound: 2, vibration: 2 });
  } finally {
    await browser?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
    await rm(root, { recursive: true, force: true });
  }
});
