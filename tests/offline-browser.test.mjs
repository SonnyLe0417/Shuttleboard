import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { launchChromium } from "./fixtures/launch-browser.mjs";
const owner = "20000000-0000-4000-8000-000000000001";
const other = "20000000-0000-4000-8000-000000000002";
const user = (id) => ({
  id,
  aud: "authenticated",
  role: "authenticated",
  email: "fake@example.test",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
  is_anonymous: false,
});
const token = (id) =>
  [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(
      JSON.stringify({
        sub: id,
        aud: "authenticated",
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        is_anonymous: false,
      }),
    ).toString("base64url"),
    "synthetic-signature",
  ].join(".");
test(
  "production offline scoreboard reopens, retains two matches, fences tabs and syncs exactly once",
  { skip: !existsSync(".output/public/offline-scoreboard-manifest.json"), timeout: 120000 },
  async () => {
    let disconnected = false;
    const publicRoot = resolve(".output/public"),
      matches = new Map(),
      errors = [],
      offlineAuthFailures = [];
    let browser, server, worker;
    let dropResponse = true,
      serveLegacyWorker = true;
    const prior = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    const originalFetch = globalThis.fetch;
    server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, "http://local");
        if (url.pathname.startsWith("/auth/v1/")) {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(user(owner)));
          return;
        }
        if (url.pathname.startsWith("/rest/v1/")) {
          res.setHeader("content-type", "application/json");
          if (url.pathname === "/rest/v1/matches") {
            if (req.method === "POST") {
              const payload = JSON.parse(Buffer.concat(await Array.fromAsync(req)).toString());
              if (matches.has(payload.id)) {
                res.statusCode = 409;
                res.end(JSON.stringify({ code: "23505", message: "duplicate key" }));
                return;
              }
              matches.set(payload.id, payload);
              res.end(JSON.stringify({ id: payload.id }));
              return;
            }
            const id = url.searchParams.get("id")?.replace(/^eq\./, "");
            const value = id ? matches.get(id) : undefined;
            res.end(
              JSON.stringify(
                value
                  ? {
                      id: value.id,
                      creator_id: value.creator_id,
                      team_a_user_ids: [owner],
                      team_b_user_ids: [],
                    }
                  : [],
              ),
            );
            return;
          }
          res.statusCode = 503;
          res.end(JSON.stringify({ message: "Synthetic progress service unavailable" }));
          return;
        }
        if (
          url.pathname.startsWith("/assets/") ||
          [
            "/sw.js",
            "/offline-scoreboard.html",
            "/offline-scoreboard-manifest.json",
            "/manifest.webmanifest",
            "/favicon.ico",
            "/shuttleboard-icon.svg",
          ].includes(url.pathname)
        ) {
          const path = resolve(publicRoot, "." + url.pathname);
          assert.ok(path.startsWith(publicRoot + sep));
          const type = path.endsWith(".js")
            ? "text/javascript"
            : path.endsWith(".css")
              ? "text/css"
              : path.endsWith(".html")
                ? "text/html"
                : path.endsWith(".json")
                  ? "application/json"
                  : "application/octet-stream";
          res.setHeader("content-type", type);
          if (url.pathname === "/sw.js" && serveLegacyWorker) {
            serveLegacyWorker = false;
            res.end(
              "self.addEventListener('install',()=>self.skipWaiting()); self.addEventListener('activate',event=>event.waitUntil(self.clients.claim())); self.addEventListener('push',()=>{});",
            );
            return;
          }
          res.end(await readFile(path));
          return;
        }
        const body = ["GET", "HEAD"].includes(req.method)
          ? undefined
          : Buffer.concat(await Array.fromAsync(req));
        const response = await worker.fetch(
          new Request(`http://127.0.0.1:${server.address().port}${req.url}`, {
            method: req.method,
            headers: req.headers,
            body,
          }),
          { ASSETS: { fetch: async () => new Response("", { status: 404 }) } },
          { waitUntil() {} },
        );
        const bytes = Buffer.from(await response.arrayBuffer());
        res.statusCode = response.status;
        response.headers.forEach((value, name) => res.setHeader(name, value));
        // Simulate a lost browser response after a cloud write has committed.
        if (req.method === "POST" && matches.size && dropResponse) {
          dropResponse = false;
          res.destroy();
          return;
        }
        res.end(bytes);
      } catch (error) {
        errors.push(error.message);
        res.statusCode = 500;
        res.end("Synthetic server error");
      }
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    process.env.SUPABASE_URL = origin;
    process.env.SUPABASE_PUBLISHABLE_KEY = "synthetic-publishable-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service-key";
    globalThis.fetch = (input, options) => {
      const url = new URL(typeof input === "string" ? input : (input.url ?? input));
      if (url.origin !== origin) throw Error("External network prohibited in offline fixture");
      return originalFetch(input, options);
    };
    try {
      worker = (await import(pathToFileURL(resolve(".output/server/index.mjs")).href)).default;
      const urls = new Set();
      for (const name of await readdir(resolve(publicRoot, "assets")))
        if (name.endsWith(".js")) {
          const content = await readFile(resolve(publicRoot, "assets", name), "utf8");
          for (const match of content.matchAll(/https:\/\/([a-z0-9-]+)\.supabase\.co/g))
            urls.add(match[1]);
        }
      assert.ok(urls.size, "find public SDK storage namespace");
      browser = await launchChromium();
      const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin === origin) return route.continue();
        if (url.pathname.startsWith("/auth/v1/")) {
          if (disconnected) return route.abort("internetdisconnected");
          const response = url.pathname.endsWith("/token")
            ? {
                access_token: token(owner),
                refresh_token: "synthetic-refresh",
                expires_in: 3600,
                expires_at: Math.floor(Date.now() / 1000) + 3600,
                token_type: "bearer",
                user: user(owner),
              }
            : user(owner);
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(response),
          });
        }
        return route.abort();
      });
      await context.addInitScript(
        ({ keys, owner, token, profile }) => {
          if (!localStorage.getItem("fixture-seeded")) {
            for (const key of keys)
              localStorage.setItem(
                `sb-${key}-auth-token`,
                JSON.stringify({
                  access_token: token,
                  refresh_token: "synthetic-refresh",
                  expires_in: 3600,
                  expires_at: Math.floor(Date.now() / 1000) + 3600,
                  token_type: "bearer",
                  user: profile,
                }),
              );
            localStorage.setItem("fixture-seeded", "1");
          }
        },
        { keys: [...urls], owner, token: token(owner), profile: user(owner) },
      );
      let page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("requestfailed", (request) => {
        const path = new URL(request.url()).pathname;
        if (
          path.startsWith("/auth/v1/") &&
          request.failure()?.errorText.includes("INTERNET_DISCONNECTED")
        )
          offlineAuthFailures.push(path);
      });
      await page.goto(origin + "/scoreboard");
      await page.getByRole("button", { name: "Enable offline scoring", exact: true }).waitFor();
      const originalScope = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        return registration.scope;
      });
      await page.getByRole("button", { name: "Enable offline scoring", exact: true }).click();
      await page
        .getByText("Online · Ready for offline scoring", { exact: true })
        .waitFor({ timeout: 65000 });
      assert.equal(
        await page.evaluate(
          async () => (await navigator.serviceWorker.getRegistration("/sw.js")).scope,
        ),
        originalScope,
      );
      disconnected = true;
      await context.setOffline(true);
      // Expire only this synthetic session. Cached local scoring must not wait for refresh.
      await page.evaluate(
        (keys) => {
          for (const key of keys) {
            const name = `sb-${key}-auth-token`,
              session = JSON.parse(localStorage.getItem(name));
            const parts = session.access_token.split(".");
            const claims = JSON.parse(atob(parts[1].replaceAll("-", "+").replaceAll("_", "/")));
            claims.exp = 1;
            parts[1] = btoa(JSON.stringify(claims))
              .replaceAll("+", "-")
              .replaceAll("/", "_")
              .replaceAll("=", "");
            session.access_token = parts.join(".");
            session.expires_at = 1;
            localStorage.setItem(name, JSON.stringify(session));
          }
        },
        [...urls],
      );
      await page.close();
      page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("requestfailed", (request) => {
        const path = new URL(request.url()).pathname;
        if (
          path.startsWith("/auth/v1/") &&
          request.failure()?.errorText.includes("INTERNET_DISCONNECTED")
        )
          offlineAuthFailures.push(path);
      });
      await page.goto(origin + "/scoreboard");
      await page
        .getByRole("button", { name: "Point to Team A", exact: true })
        .waitFor()
        .catch(async (error) => {
          console.log(
            "Offline failure details",
            JSON.stringify({
              errors,
              body: (await page.content()).slice(0, 2500),
              url: page.url(),
            }),
          );
          throw error;
        });
      await page.getByRole("button", { name: "Golden Point · Single", exact: true }).click();
      for (let n = 0; n < 2; n++)
        await page.getByRole("button", { name: "Point to Team A", exact: true }).click();
      await page.reload();
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal(await page.locator(".score-num").first().textContent(), "1");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal(await page.locator(".score-num").first().textContent(), "0");
      for (let n = 0; n < 21; n++)
        await page.getByRole("button", { name: "Point to Team A", exact: true }).click();
      await page.getByRole("button", { name: "Saved on device", exact: true }).waitFor();
      await page.getByRole("button", { name: "New match", exact: true }).click();
      for (let n = 0; n < 21; n++)
        await page.getByRole("button", { name: "Point to Team A", exact: true }).click();
      await page.getByText("2 pending matches", { exact: true }).waitFor();
      await page.reload();
      await page.getByText("2 pending matches", { exact: true }).waitFor();
      assert.equal(matches.size, 0);
      const originalResults = await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const open = indexedDB.open("shuttleboard-offline-v1");
            open.onsuccess = () => {
              const request = open.result.transaction("queue").objectStore("queue").getAll();
              request.onsuccess = () => {
                resolve(request.result.map((row) => ({ id: row.id, payload: row.payload })));
                open.result.close();
              };
              request.onerror = () => reject(request.error);
            };
            open.onerror = () => reject(open.error);
          }),
      );

      const second = await context.newPage();
      await second.goto(origin + "/scoreboard");
      await second
        .getByText("This match is open in another tab. This tab is read-only.", { exact: true })
        .waitFor();
      await second.getByRole("button", { name: "Take over scoring", exact: true }).click();
      await page
        .getByText("This match is open in another tab. This tab is read-only.", { exact: true })
        .waitFor();
      await page.close();
      page = second;
      disconnected = false;
      await context.setOffline(false);
      await page.getByText("2 pending matches", { exact: true }).click();
      await page.getByRole("button", { name: "Sync now", exact: true }).click();
      await page
        .getByText("0 pending matches", { exact: true })
        .waitFor({ timeout: 35000 })
        .catch(async (error) => {
          console.log(
            "Sync failure details",
            JSON.stringify({
              cloudCount: matches.size,
              errors,
              body: await page.locator("body").innerText(),
              queue: await page.evaluate(
                () =>
                  new Promise((resolve, reject) => {
                    const r = indexedDB.open("shuttleboard-offline-v1");
                    r.onsuccess = () => {
                      const tx = r.result.transaction("queue"),
                        q = tx.objectStore("queue").getAll();
                      q.onsuccess = () =>
                        resolve(
                          q.result.map(({ status, attempts, error }) => ({
                            status,
                            attempts,
                            error,
                          })),
                        );
                    };
                    r.onerror = () => reject(r.error);
                  }),
              ),
            }),
          );
          throw error;
        });
      assert.equal(matches.size, 2);
      for (const row of matches.values()) {
        assert.equal(row.creator_id, owner);
        const original = originalResults.find((result) => result.id === row.id).payload;
        assert.equal(row.started_at, original.started_at);
        assert.equal(row.finished_at, original.finished_at);
        assert.equal(row.duration_seconds, original.duration_seconds);
        assert.equal(row.winner, "A");
        assert.equal(row.games.length, 1);
        assert.ok(Date.parse(row.finished_at) >= Date.parse(row.started_at));
      }
      const cacheUrls = await page.evaluate(async () => {
        const result = [];
        for (const name of await caches.keys())
          for (const req of await (await caches.open(name)).keys())
            result.push(new URL(req.url).pathname);
        return result;
      });
      assert.ok(
        cacheUrls.every(
          (path) =>
            path.startsWith("/assets/") ||
            [
              "/offline-scoreboard.html",
              "/offline-active",
              "/shuttleboard-icon.svg",
              "/favicon.ico",
            ].includes(path),
        ),
      );
      assert.deepEqual(errors, []);
      assert.ok(
        offlineAuthFailures.length > 0,
        "expired session refresh was genuinely blocked while offline",
      );
      await context.close();
    } finally {
      await browser?.close();
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(prior))
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
  },
);
