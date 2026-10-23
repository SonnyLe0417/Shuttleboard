// Local-only adapter for reviewing the Cloudflare-targeted production build.
// Deployment continues to use Nitro's generated Cloudflare worker unchanged.
import { createServer } from "node:http";
import { readFile, readdir, appendFile, mkdir } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnv } from "vite";

Object.assign(process.env, loadEnv("production", process.cwd(), ""));
const worker = (await import(pathToFileURL(resolve(".output/server/index.mjs")).href)).default;
const publicRoot = resolve(".output/public");
// Opt-in local measurements contain names/timings/sizes only, never request or response content.
const metricFunctions = new Map();
if (process.env.DASHBOARD_METRICS === "1") {
  for (const file of await readdir(resolve(".output/server/_ssr"))) {
    if (!file.startsWith("dashboard.functions-") || !file.endsWith(".mjs")) continue;
    const source = await readFile(resolve(".output/server/_ssr", file), "utf8");
    for (const match of source.matchAll(
      /var (getDashboard(?:Core|Summary)) =[\s\S]*?createSsrRpc\("([a-f0-9]+)"\)/g,
    ))
      metricFunctions.set(match[2], match[1]);
    for (const match of source.matchAll(
      /id:\s*"([a-f0-9]+)",\s*name:\s*"(getDashboard(?:Core|Summary))"/g,
    ))
      metricFunctions.set(match[1], match[2]);
  }
  await mkdir(resolve("docs/performance"), { recursive: true });
}
const types = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
};
async function asset(request) {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const file = resolve(publicRoot, `.${pathname}`);
  if (!file.startsWith(publicRoot + sep)) return new Response("Not found", { status: 404 });
  try {
    return new Response(await readFile(file), {
      headers: { "content-type": types[extname(file)] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
const port = Number(process.env.PORT ?? 4174);
const server = createServer(async (req, res) => {
  try {
    const url = `http://127.0.0.1:${port}${req.url}`;
    const body = ["GET", "HEAD"].includes(req.method)
      ? undefined
      : await Array.fromAsync(req).then((chunks) => Buffer.concat(chunks));
    const request = new Request(url, { method: req.method, headers: req.headers, body });
    const started = performance.now();
    const response = await worker.fetch(
      request,
      { ...process.env, ASSETS: { fetch: asset } },
      { waitUntil: (promise) => promise.catch(() => {}), passThroughOnException() {} },
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    const name = metricFunctions.get(new URL(url).pathname.split("/").at(-1));
    if (name) {
      const metric = {
        recordedAt: new Date().toISOString(),
        name,
        durationMs: performance.now() - started,
        responseBytes: bytes.length,
        status: response.status,
      };
      await appendFile(
        resolve("docs/performance/dashboard-live.jsonl"),
        JSON.stringify(metric) + "\n",
      );
      console.log(
        "Dashboard request:",
        name,
        Math.round(metric.durationMs),
        "ms",
        bytes.length,
        "bytes",
      );
    }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(req.method === "HEAD" ? undefined : bytes);
  } catch (error) {
    console.error("Local preview request failed:", error.message);
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("The local preview could not load this page. Check the terminal.");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`ShuttleBoard production preview: http://127.0.0.1:${port}`),
);
