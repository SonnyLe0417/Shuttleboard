import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
async function fixture() {
  const handlers = new Map(),
    stores = new Map(),
    calls = [],
    notifications = [];
  const origin = "https://synthetic.example";
  let offline = false;
  let manifest = {
    version: "a".repeat(64),
    assets: ["/offline-scoreboard.html", "/assets/score.js", "/shuttleboard-icon.svg"],
  };
  const caches = {
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const map = stores.get(name);
      return {
        async match(path) {
          return map
            .get(new URL(typeof path === "string" ? path : path.url, origin).pathname)
            ?.clone();
        },
        async put(path, response) {
          map.set(
            new URL(typeof path === "string" ? path : path.url, origin).pathname,
            response.clone(),
          );
        },
      };
    },
  };
  const self = {
    location: { origin },
    clients: { matchAll: async () => [{}], claim: async () => {} },
    skipWaiting: async () => {},
    registration: { showNotification: async (...args) => notifications.push(args) },
    addEventListener(name, fn) {
      handlers.set(name, fn);
    },
  };
  runInNewContext(await readFile("public/sw.js", "utf8"), {
    self,
    caches,
    URL,
    Response,
    AbortSignal,
    crypto,
    fetch: async (input, options) => {
      const path = new URL(typeof input === "string" ? input : input.url, origin).pathname;
      calls.push({ path, options });
      if (offline) throw Error("offline");
      if (path === "/offline-scoreboard-manifest.json") return Response.json(manifest);
      if (path === "/offline-scoreboard.html")
        return new Response("<html><body>Generic scoreboard shell</body></html>", {
          headers: { "content-type": "text/html" },
        });
      if (path === "/assets/score.js")
        return new Response("export const score=true", {
          headers: { "content-type": "text/javascript" },
        });
      if (path === "/shuttleboard-icon.svg")
        return new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } });
      return new Response("Not found", { status: 404 });
    },
  });
  const prepare = async () => {
    let pending, reply;
    handlers.get("message")({
      data: { type: "PREPARE_SCOREBOARD" },
      source: { url: origin + "/scoreboard" },
      ports: [
        {
          postMessage(value) {
            reply = value;
          },
        },
      ],
      waitUntil(promise) {
        pending = promise;
      },
    });
    await pending;
    return reply;
  };
  const navigation = async (path, method = "GET", mode = "navigate") => {
    let response;
    handlers.get("fetch")({
      request: { url: origin + path, method, mode },
      respondWith(promise) {
        response = promise;
      },
    });
    return response ? await response : null;
  };
  return {
    handlers,
    caches,
    calls,
    notifications,
    prepare,
    navigation,
    setManifest: (value) => {
      manifest = value;
    },
    setOffline: (value) => {
      offline = value;
    },
  };
}
test("offline preparation commits complete public assets and retains the old copy on failure", async () => {
  const f = await fixture();
  assert.equal((await f.prepare()).ok, true);
  const meta = await f.caches.open("shuttleboard-scoreboard-meta"),
    first = await (await meta.match("/offline-active")).json();
  assert.ok(f.calls.every((call) => call.options.credentials === "omit"));
  f.setManifest({
    version: "b".repeat(64),
    assets: ["/offline-scoreboard.html", "/assets/missing.js"],
  });
  assert.equal((await f.prepare()).ok, false);
  assert.equal((await (await meta.match("/offline-active")).json()).name, first.name);
  assert.equal((await f.caches.keys()).length, 2, "failed staging cache is removed");
  f.setOffline(true);
  assert.match(await (await f.navigation("/scoreboard")).text(), /Generic scoreboard shell/);
  assert.equal(
    (await f.navigation("/")).headers.get("location"),
    "https://synthetic.example/scoreboard",
  );
  assert.equal((await f.navigation("/history")).status, 503);
});
test("worker never caches API responses, private navigation documents or mutation requests", async () => {
  const f = await fixture();
  f.setManifest({ version: "c".repeat(64), assets: ["/offline-scoreboard.html", "/api/private"] });
  assert.equal((await f.prepare()).ok, false);
  assert.equal(await f.navigation("/_serverFn/save", "POST", "cors"), null);
  assert.equal(await f.navigation("/api/private", "GET", "cors"), null);
  assert.ok(!f.calls.some((call) => call.path === "/api/private"));
});
test("extending offline support preserves the push notification handler", async () => {
  const f = await fixture();
  let pending;
  f.handlers.get("push")({
    data: { json: () => ({ title: "Synthetic reminder", body: "Fake data" }) },
    waitUntil(promise) {
      pending = promise;
    },
  });
  await pending;
  assert.equal(f.notifications[0][0], "Synthetic reminder");
  assert.equal(f.notifications[0][1].body, "Fake data");
  assert.equal(f.notifications[0][1].data.url, "/");
});
