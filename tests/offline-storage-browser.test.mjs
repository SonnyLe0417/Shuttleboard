import test from "node:test";
import assert from "node:assert/strict";
import { build } from "vite";
import { launchChromium } from "./fixtures/launch-browser.mjs";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
test(
  "real IndexedDB retains failures, fences editors, isolates accounts and coordinates retrying sync",
  { timeout: 60000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "shuttleboard-offline-storage-"));
    let server, browser;
    try {
      await build({
        configFile: false,
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        build: {
          outDir: root,
          emptyOutDir: false,
          lib: {
            entry: resolve("tests/fixtures/offline-storage.mjs"),
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
            : '<!doctype html><html><body><script type="module" src="/fixture.js"></script></body></html>',
        );
      });
      await new Promise((done) => server.listen(0, "127.0.0.1", done));
      browser = await launchChromium();
      const context = await browser.newContext(),
        page = await context.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.offlineFixture);
      const result = await page.evaluate(async () => {
        const f = window.offlineFixture,
          owner = "owner-a",
          other = "owner-b";
        await f.selectOfflineAccount(owner, true);
        const first = await f.acquireEditor(owner, "first"),
          denied = await f.acquireEditor(owner, "second");
        const draft = {
          owner,
          id: "stable-match",
          state: { score: [21, 0] },
          updatedAt: Date.now(),
        };
        const queued = {
          owner,
          id: "stable-match",
          payload: { finished_at: "2026-10-25T00:00:00Z" },
          status: "pending",
          attempts: 0,
          nextAttempt: 0,
        };
        await f.saveLocalDraft(draft, first, queued);
        let rolledBack = false;
        try {
          await f.offlineTransaction(["drafts", "queue"], "readwrite", async (tx) => {
            tx.objectStore("drafts").put({ ...draft, state: { score: [99, 99] } });
            tx.objectStore("queue").put({ ...queued, status: "error" });
            tx.abort();
          });
        } catch {
          rolledBack = true;
        }
        const afterRollback = await f.readDraft(owner);
        const descriptor = Object.getOwnPropertyDescriptor(window, "indexedDB");
        let unavailable = false;
        try {
          Object.defineProperty(window, "indexedDB", {
            configurable: true,
            value: {
              open() {
                throw Error("Synthetic unavailable storage");
              },
            },
          });
          await f.openOfflineDb();
        } catch {
          unavailable = true;
        } finally {
          if (descriptor) Object.defineProperty(window, "indexedDB", descriptor);
          else delete window.indexedDB;
        }
        const second = await f.acquireEditor(owner, "second", true);
        let fenced = false;
        try {
          await f.saveLocalDraft({ ...draft, state: { score: [99, 0] } }, first);
        } catch {
          fenced = true;
        }
        await f.selectOfflineAccount(other, true);
        let isolated = false;
        try {
          await f.saveLocalDraft(draft, second);
        } catch {
          isolated = true;
        }
        const otherRows = await f.readQueue(other);
        await f.selectOfflineAccount(owner, true);
        await f.saveLocalDraft(draft, second, {
          ...queued,
          payload: { changed: "must not overwrite" },
        });
        let uploads = 0;
        const cloud = new Set();
        let fail = true;
        const upload = async () => {
          uploads++;
          cloud.add("stable-match");
          if (fail) {
            fail = false;
            throw new TypeError("Synthetic lost response");
          }
          return { id: "stable-match", progressPending: false };
        };
        const options = {
          upload,
          currentUser: async () => owner,
          changed() {},
          signal: new AbortController().signal,
        };
        await f.syncOfflineQueue(owner, options);
        const pending = (await f.readQueue(owner))[0];
        await Promise.all([
          f.syncOfflineQueue(owner, { ...options, manual: true }),
          f.syncOfflineQueue(owner, { ...options, manual: true }),
        ]);
        const synced = (await f.readQueue(owner))[0];
        await f.offlineAuthChanged("SIGNED_OUT", null);
        const expiryRetained = (await f.offlineAccount())?.id === owner;
        await f.signOutOfflineAccount();
        let signedOutUploads = 0;
        await f.syncOfflineQueue(owner, {
          upload: async () => {
            signedOutUploads++;
          },
          currentUser: async () => owner,
          changed() {},
          manual: true,
        });
        const hidden = await f.offlineAccount();
        await f.offlineAuthChanged("SIGNED_IN", owner);
        const restored = (await f.readQueue(owner))[0];
        await f.updateQueued(owner, "stable-match", {
          status: "pending",
          receipt: undefined,
          nextAttempt: 0,
        });
        await f.syncOfflineQueue(owner, {
          upload: async () => {
            throw Error("must not upload");
          },
          currentUser: () => new Promise(() => {}),
          changed() {},
          timeoutMs: 5,
        });
        const timedOut = (await f.readQueue(owner))[0];
        await f.updateQueued(owner, "stable-match", { status: "pending", nextAttempt: 0 });
        await f.syncOfflineQueue(owner, {
          upload: async () => {
            throw Object.assign(new Error("Unauthorized"), { status: 401 });
          },
          currentUser: async () => owner,
          changed() {},
        });
        const auth = (await f.readQueue(owner))[0];
        await f.saveLocalDraft({ ...draft, id: "second-match" }, second, {
          ...queued,
          id: "second-match",
        });
        let blockedUploads = 0;
        await f.syncOfflineQueue(owner, {
          upload: async () => {
            blockedUploads++;
            return { id: "second-match", progressPending: false };
          },
          currentUser: async () => owner,
          changed() {},
        });
        await f.offlineTransaction(["queue"], "readwrite", async (tx) => {
          tx.objectStore("queue").delete("second-match");
        });

        await f.updateQueued(owner, "stable-match", { status: "pending", nextAttempt: 0 });
        await f.syncOfflineQueue(owner, {
          upload: async () => {
            throw new Error("Validation: invalid result");
          },
          currentUser: async () => owner,
          changed() {},
        });
        const invalid = (await f.readQueue(owner))[0];

        let invalidRetries = 0;
        await f.syncOfflineQueue(owner, {
          upload: async () => {
            invalidRetries++;
          },
          currentUser: async () => owner,
          changed() {},
          manual: true,
        });
        return {
          rolledBack,
          rollbackScore: afterRollback.state.score,
          unavailable,
          expiryRetained,
          denied,
          fenced,
          isolated,
          otherCount: otherRows.length,
          pending: pending.status,
          attempts: pending.attempts,
          originalPayload: pending.payload,
          synced: synced.status,
          cloudCount: cloud.size,
          uploads,
          signedOutUploads,
          hidden: !!hidden,
          restored: restored.status,
          auth: auth.status,
          invalid: invalid.status,
          invalidRetries,
          blockedUploads,
          timedOut: timedOut.status,
        };
      });
      assert.equal(result.rolledBack, true);
      assert.deepEqual(result.rollbackScore, [21, 0]);
      assert.equal(result.unavailable, true);
      assert.equal(result.expiryRetained, true);
      assert.equal(result.denied, null);
      assert.equal(result.fenced, true);
      assert.equal(result.isolated, true);
      assert.equal(result.otherCount, 0);
      assert.equal(result.pending, "pending");
      assert.equal(result.attempts, 1);
      assert.equal(result.originalPayload.finished_at, "2026-10-25T00:00:00Z");
      assert.equal(result.synced, "synced");
      assert.equal(result.cloudCount, 1);
      assert.equal(result.uploads, 2);
      assert.equal(result.signedOutUploads, 0);
      assert.equal(result.hidden, false);
      assert.equal(result.restored, "synced");
      assert.equal(result.timedOut, "pending");
      assert.equal(result.auth, "auth");
      assert.equal(result.blockedUploads, 0);
      assert.equal(result.invalid, "error");
      assert.equal(result.invalidRetries, 0);
      await context.close();
    } finally {
      await browser?.close();
      if (server) {
        server.closeAllConnections();
        await new Promise((done) => server.close(done));
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);
