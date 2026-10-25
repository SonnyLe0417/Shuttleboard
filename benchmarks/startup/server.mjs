import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { loadEnv } from "vite";
import { response } from "../dashboard/fixtures.mjs";
import { allowedControl, instrumentHtml } from "./measure-server.mjs";
import { buildRegistry } from "./build-runtime.mjs";

export async function createStartupServer({
  root = resolve(process.env.STARTUP_ROOT ?? ".output"),
  measurementAvailable = process.env.STARTUP_MEASURE === "1",
  fixtures = process.env.STARTUP_FIXTURES === "1",
  env = loadEnv("production", process.cwd(), ""),
  buildRoots = {
    baseline: resolve("dist/startup/baseline/production"),
    optimized: resolve("dist/startup/optimized/production"),
  },
} = {}) {
  const registry = buildRegistry({ ...process.env, ...env });
  let active = {
    ...(await registry.get(root)),
    build: root.includes("baseline") ? "baseline" : "optimized",
    measuring: measurementAvailable,
  };
  let switches = Promise.resolve();
  const server = createServer(async (req, res) => {
    // A response keeps its runtime, label and measurement mode across every await.
    const selection = active;
    try {
      const port = server.address().port;
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname === "/__startup-measure") {
        if (!measurementAvailable) {
          res.writeHead(404).end();
          return;
        }
        if (req.method === "POST") {
          if (!allowedControl(req, port)) {
            res.writeHead(403).end();
            return;
          }
          let input = "";
          for await (const chunk of req) {
            input += chunk;
            if (input.length > 100) {
              res.writeHead(413).end();
              return;
            }
          }
          const selected = new URLSearchParams(input).get("build");
          if (!["baseline", "optimized", "off"].includes(selected)) {
            res.writeHead(400).end();
            return;
          }
          const target = selected === "off" ? "optimized" : selected;
          const change = switches.then(async () => {
            const next = await registry.get(buildRoots[target]);
            active = { ...next, build: target, measuring: selected !== "off" };
          });
          switches = change.catch(() => {});
          await change;
          res.writeHead(303, { location: "/dashboard", "cache-control": "no-store" }).end();
          return;
        }
        if (req.method !== "GET") {
          res.writeHead(405).end();
          return;
        }
        res
          .writeHead(200, { "content-type": "text/html", "cache-control": "no-store" })
          .end(
            '<!doctype html><title>Local measurement control</title><h1>Local measurement control</h1><form method="post"><button name="build" value="baseline">Baseline</button><button name="build" value="optimized">Optimized</button><button name="build" value="off">Finish on optimized without measurement</button></form>',
          );
        return;
      }
      if (url.pathname.startsWith("/__startup-fixture/")) {
        if (!fixtures) {
          res.writeHead(404).end();
          return;
        }
        let body = "";
        for await (const chunk of req) body += chunk;
        const name = url.pathname.split("/").at(-1),
          count = Number(url.searchParams.get("count"));
        const mapping = {
          getDashboardCore: "core",
          getDashboardSummary: "summary",
          getProgressSummary: "progress",
          listMyMatches: "matches",
          getMyPreferences: "preferences",
        };
        let value;
        if (name === "getOnboardingStatus") value = { onboarded: true };
        else if (mapping[name])
          value = response("optimized", mapping[name], count, JSON.parse(body || "{}"));
        else throw Error("Unsupported synthetic function");
        await new Promise((resolve) => setTimeout(resolve, 20));
        res
          .writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
          .end(JSON.stringify(value));
        return;
      }
      const body = ["GET", "HEAD"].includes(req.method)
        ? undefined
        : Buffer.concat(await Array.fromAsync(req));
      const request = new Request(url, { method: req.method, headers: req.headers, body });
      const result = await selection.runtime.fetch(request);
      let bytes = Buffer.from(result.body);
      const headers = Object.fromEntries(result.headers.filter(([name]) => name !== "set-cookie"));
      const cookies = result.headers
        .filter(([name]) => name === "set-cookie")
        .map(([, value]) => value);
      if (cookies.length) headers["set-cookie"] = cookies;
      if (
        selection.measuring &&
        headers["content-type"]?.includes("text/html") &&
        result.status === 200
      ) {
        bytes = await instrumentHtml(bytes, selection.build, selection.fingerprint);
        headers["cache-control"] = "no-store";
        delete headers["content-length"];
        delete headers.etag;
      }
      if (
        /javascript|text\/|json|svg/.test(headers["content-type"] ?? "") &&
        req.headers["accept-encoding"]?.includes("gzip")
      ) {
        bytes = gzipSync(bytes);
        headers["content-encoding"] = "gzip";
        headers.vary = "Accept-Encoding";
        delete headers["content-length"];
      }
      res.writeHead(result.status, headers).end(req.method === "HEAD" ? undefined : bytes);
    } catch (error) {
      console.error("Startup preview failure", error instanceof Error ? error.name : "unknown");
      res.writeHead(500).end("Local preview error");
    }
  });
  let closing;
  const close = () =>
    (closing ??= (async () => {
      const stopped = server.listening
        ? new Promise((resolve) => server.close(resolve))
        : Promise.resolve();
      await registry.close();
      server.closeAllConnections();
      await stopped;
    })());
  return { server, close };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT ?? 4190);
  const preview = await createStartupServer();
  preview.server.once("error", async () => {
    await preview.close();
    process.exitCode = 1;
  });
  preview.server.listen(port, "127.0.0.1", () => console.log(`Startup preview listening ${port}`));
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => void preview.close().then(() => process.exit(0)));
}
