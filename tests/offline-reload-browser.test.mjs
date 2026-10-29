import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { build } from "vite";
import { launchChromium } from "./fixtures/launch-browser.mjs";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
const stashKey = "shuttleboard.offline-unsaved-draft.v1:20000000-0000-4000-8000-000000000001";
let root, server, browser, origin;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "shuttleboard-offline-reload-"));
  const stubs = resolve("tests/fixtures/offline-reload-stubs.mjs");
  await build({
    configFile: false,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    resolve: {
      alias: [
        { find: /^@tanstack\/react-start$/, replacement: stubs },
        { find: /^@\/lib\/(matches\.functions|browser-supabase)$/, replacement: stubs },
        { find: "@", replacement: resolve("src") },
      ],
    },
    build: {
      outDir: root,
      emptyOutDir: false,
      lib: {
        entry: resolve("tests/fixtures/offline-reload.mjs"),
        formats: ["es"],
        fileName: () => "fixture.js",
      },
      minify: false,
    },
    logLevel: "error",
  });
  const script = await readFile(join(root, "fixture.js"));
  server = createServer((req, res) => {
    res.setHeader("content-type", req.url === "/fixture.js" ? "text/javascript" : "text/html");
    res.end(
      req.url === "/fixture.js"
        ? script
        : '<!doctype html><html><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
    );
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await launchChromium();
});
after(async () => {
  await browser?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
  await rm(root, { recursive: true, force: true });
});
test(
  "a point tapped straight before a reload reopens with its undo history",
  { timeout: 60000 },
  async () => {
    const context = await browser.newContext(),
      page = await context.newPage();
    await page.goto(origin);
    const point = page.getByRole("button", { name: "Point to Team A", exact: true });
    await point.click();
    await page.waitForFunction(
      async () => (await offline.readDraft(offline.owner))?.state.score[0] === 1,
    );
    // The second point's IndexedDB save cannot land before the page goes away.
    await page.evaluate(() => holdDraftSaves());
    await point.click();
    await page.reload();
    await page.waitForFunction(() => document.querySelector("output")?.textContent);
    assert.equal(await page.locator("output").textContent(), "2-0 undo 2");
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), stashKey), null);
    await context.close();
  },
);
test("a stashed save replays only under the lease that wrote it", async () => {
  const context = await browser.newContext(),
    page = await context.newPage();
  await page.goto(origin + "/?storage");
  const first = await page.evaluate(async () => {
    const { owner } = offline;
    await offline.selectOfflineAccount(owner, true);
    const lease = await offline.acquireEditor(owner, "first");
    await offline.saveLocalDraft({ owner, id: "m", state: { score: [1, 0] }, updatedAt: 1 }, lease);
    await holdDraftSaves();
    void offline
      .saveLocalDraft({ owner, id: "m", state: { score: [2, 0] }, updatedAt: 2 }, lease)
      .catch(() => {});
    offline.stashUnsavedDraft();
    return lease;
  });
  await page.reload();
  const late = await page.evaluate(async (first) => {
    const { owner } = offline;
    // The writer's lease has lapsed before the next editor opens the match.
    const lease = await offline.acquireEditor(owner, "late", false, first.expires + 1);
    const recovered = (await offline.readDraft(owner)).state.score;
    await holdDraftSaves();
    // The first editor is now fenced out: neither its save nor its stash may land.
    void offline
      .saveLocalDraft({ owner, id: "m", state: { score: [3, 0] }, updatedAt: 3 }, first)
      .catch(() => {});
    offline.stashUnsavedDraft();
    return { fence: lease.fence, recovered };
  }, first);
  assert.deepEqual(late, { fence: first.fence + 1, recovered: [2, 0] });
  await page.reload();
  const reopened = await page.evaluate(async (key) => {
    await offline.acquireEditor(offline.owner, "third");
    return {
      score: (await offline.readDraft(offline.owner)).state.score,
      stash: localStorage.getItem(key),
    };
  }, stashKey);
  assert.deepEqual(reopened, { score: [2, 0], stash: null });
  await context.close();
});
