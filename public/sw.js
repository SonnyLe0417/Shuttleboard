// ShuttleBoard push service worker
self.addEventListener("install", () => {});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Only retire old code when no document can still import it.
      if (!(await self.clients.matchAll({ includeUncontrolled: true })).length) {
        const active = await activeOfflineCache();
        for (const name of await caches.keys())
          if (name.startsWith(OFFLINE_PREFIX) && name !== OFFLINE_META && name !== active?.name)
            await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

const OFFLINE_PREFIX = "shuttleboard-scoreboard-";
const OFFLINE_META = "shuttleboard-scoreboard-meta";
async function activeOfflineCache() {
  const meta = await caches.open(OFFLINE_META);
  const response = await meta.match("/offline-active");
  return response ? response.json() : null;
}
let preparing;
async function prepareScoreboard() {
  const manifestResponse = await fetch("/offline-scoreboard-manifest.json", {
    credentials: "omit",
    cache: "no-store",
  });
  if (!manifestResponse.ok)
    throw Error("Offline files are unavailable. Try again after the production build is ready.");
  const manifest = await manifestResponse.json();
  if (
    !/^[a-f0-9]{64}$/.test(manifest.version) ||
    !Array.isArray(manifest.assets) ||
    !manifest.assets.includes("/offline-scoreboard.html") ||
    manifest.assets.some(
      (path) =>
        typeof path !== "string" ||
        !(
          ["/offline-scoreboard.html", "/shuttleboard-icon.svg", "/favicon.ico"].includes(path) ||
          /^\/assets\/[A-Za-z0-9_./-]+$/.test(path)
        ) ||
        path.includes(".."),
    )
  )
    throw Error("Invalid offline asset manifest.");
  const active = await activeOfflineCache();
  if (active?.version === manifest.version) {
    const old = await caches.open(active.name);
    if ((await Promise.all(manifest.assets.map((path) => old.match(path)))).every(Boolean)) {
      const meta = await caches.open(OFFLINE_META);
      await meta.put("/offline-active", Response.json({ ...active, assets: manifest.assets }));
      return;
    }
  }
  const name = OFFLINE_PREFIX + manifest.version + "-" + crypto.randomUUID(),
    cache = await caches.open(name);
  try {
    for (const path of manifest.assets) {
      const response = await fetch(path, { credentials: "omit", cache: "no-store" });
      const type = response.headers.get("content-type") ?? "";
      if (
        !response.ok ||
        response.redirected ||
        (path.endsWith(".js") && !/javascript/.test(type)) ||
        (path.endsWith(".css") && !/text\/css/.test(type)) ||
        (path.endsWith(".html") && !/text\/html/.test(type))
      )
        throw Error(
          "An offline file could not be downloaded. The previous offline copy was retained.",
        );
      await cache.put(path, response);
    }
    const meta = await caches.open(OFFLINE_META);
    await meta.put(
      "/offline-active",
      Response.json({ name, version: manifest.version, assets: manifest.assets }),
    );
  } catch (error) {
    await caches.delete(name);
    throw error;
  }
}
self.addEventListener("message", (event) => {
  if (
    event.data?.type !== "PREPARE_SCOREBOARD" ||
    !event.ports[0] ||
    !event.source?.url ||
    new URL(event.source.url).origin !== self.location.origin
  )
    return;
  event.waitUntil(
    (async () => {
      try {
        preparing ??= prepareScoreboard().finally(() => {
          preparing = undefined;
        });
        await preparing;
        await self.skipWaiting();
        await self.clients.claim();
        event.ports[0].postMessage({ ok: true });
      } catch (error) {
        event.ports[0].postMessage({ ok: false, error: error.message });
      }
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const online = await fetch(request, { signal: AbortSignal.timeout(4000) });
          if (online.ok) return online;
          throw Error();
        } catch {
          if (url.pathname === "/")
            return Response.redirect(new URL("/scoreboard", self.location.origin), 302);
          if (url.pathname !== "/scoreboard")
            return new Response(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ShuttleBoard offline</title></head><body><h1>This page needs internet</h1><p>You can still use a prepared offline scoreboard.</p><a href="/scoreboard">Open scoreboard</a></body></html>',
              { status: 503, headers: { "content-type": "text/html" } },
            );
          const active = await activeOfflineCache();
          if (active) {
            const cache = await caches.open(active.name),
              shell = await cache.match("/offline-scoreboard.html");
            if (shell) return shell;
          }
          return new Response(
            "Connect to the internet and enable offline scoring on the scoreboard first.",
            { status: 503, headers: { "content-type": "text/plain" } },
          );
        }
      })(),
    );
  } else if (
    url.pathname.startsWith("/assets/") ||
    ["/shuttleboard-icon.svg", "/favicon.ico"].includes(url.pathname)
  ) {
    event.respondWith(
      (async () => {
        const active = await activeOfflineCache();
        if (active) {
          const cached = await (await caches.open(active.name)).match(url.pathname);
          if (cached) return cached;
        }
        // Keep old build assets available to tabs already playing through an update.
        for (const name of await caches.keys())
          if (name.startsWith(OFFLINE_PREFIX) && name !== OFFLINE_META) {
            const cached = await (await caches.open(name)).match(url.pathname);
            if (cached) return cached;
          }
        return fetch(request);
      })(),
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = { title: "ShuttleBoard", body: "You have a new update", url: "/", tag: "default" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (_e) {
    if (event.data) payload.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      tag: payload.tag,
      data: { url: payload.url ?? "/" },
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
