// Real development-server smoke check: SSR responds and frontend files remain watched.
import assert from "node:assert/strict";
import { writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";

const probe = resolve(`src/.vite-watch-smoke-${process.pid}.ts`);
const server = await createServer({
  configFile: "vite.config.ts",
  cacheDir: "node_modules/.vite-startup-smoke",
  server: { host: "127.0.0.1", port: 5182, strictPort: true },
});
function watchEvent(event) {
  return new Promise((resolveEvent, reject) => {
    const onEvent = (file) => {
      if (resolve(file) !== probe) return;
      clearTimeout(timeout);
      server.watcher.off(event, onEvent);
      resolveEvent();
    };
    const timeout = setTimeout(() => {
      server.watcher.off(event, onEvent);
      reject(new Error(`Frontend watcher did not emit ${event}`));
    }, 10_000);
    server.watcher.on(event, onEvent);
  });
}
try {
  await server.listen();
  const address = server.httpServer.address();
  const routes = [];
  for (const path of ["/", "/auth", "/dashboard"]) {
    const started = performance.now();
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(30_000),
    });
    const html = await response.text();
    assert.equal(response.status, 200, `${path} should serve its app shell`);
    assert.ok(
      html.includes("tanstack-start-dev-client-entry"),
      `${path} should include the app entry`,
    );
    routes.push({
      path,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
    });
  }
  const directories = Object.keys(server.watcher.getWatched());
  const tracknetDirectories = directories.filter((path) =>
    path.replaceAll("\\", "/").includes("/.tracknet-v3"),
  );
  assert.equal(tracknetDirectories.length, 0, "Frontend must not watch the Python environment");
  const added = watchEvent("add");
  await writeFile(probe, "export {};\n");
  await added;
  const changed = watchEvent("change");
  await writeFile(probe, "export {}; // watcher smoke check\n");
  await changed;
  console.log(
    JSON.stringify(
      { routes, tracknetDirectoriesWatched: 0, frontendChangeObserved: true },
      null,
      2,
    ),
  );
} finally {
  await unlink(probe).catch(() => {});
  await server.close();
}
