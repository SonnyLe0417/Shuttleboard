import { parentPort, workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { pathToFileURL } from "node:url";

// Only this worker imports this build's application runtime and SSR globals.
const publicRoot = resolve(workerData.root, "public");
const types = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".webp": "image/webp",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
};
async function asset(request) {
  const file = resolve(publicRoot, `.${decodeURIComponent(new URL(request.url).pathname)}`);
  if (!file.startsWith(publicRoot + sep)) return new Response("Not found", { status: 404 });
  try {
    return new Response(await readFile(file), {
      headers: {
        "content-type": types[extname(file)] ?? "application/octet-stream",
        "cache-control": "public,max-age=3600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
try {
  Object.assign(process.env, workerData.env);
  const app = (await import(pathToFileURL(resolve(workerData.root, "server/index.mjs")).href))
    .default;
  parentPort.on("message", async ({ id, url, method, headers, body }) => {
    try {
      const response = await app.fetch(
        new Request(url, { method, headers, body }),
        { ...workerData.env, ASSETS: { fetch: asset } },
        { waitUntil: (p) => p.catch(() => {}), passThroughOnException() {} },
      );
      const pairs = [...response.headers].filter(([name]) => name !== "set-cookie");
      for (const cookie of response.headers.getSetCookie()) pairs.push(["set-cookie", cookie]);
      parentPort.postMessage({
        id,
        status: response.status,
        headers: pairs,
        body: new Uint8Array(await response.arrayBuffer()),
      });
    } catch {
      parentPort.postMessage({ id, failed: true });
    }
  });
  parentPort.postMessage({ ready: true });
} catch {
  // Never transmit application errors or request data through diagnostics.
  parentPort.postMessage({ startupFailed: true });
  parentPort.close();
}
