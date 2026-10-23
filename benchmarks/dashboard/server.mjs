import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { response } from "./fixtures.mjs";
const version = process.env.DASHBOARD_BENCHMARK_VERSION ?? "baseline";
const metadata = JSON.parse(
  await readFile(resolve("docs/performance/dashboard-source-baseline.json"), "utf8"),
);
const contract = version === "baseline" && metadata.contract === "split" ? "optimized" : version;
const root = resolve(`dist/dashboard-benchmark/${version}`);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/__fixture/")) {
      let body = "";
      for await (const chunk of req) body += chunk;
      const name = url.pathname.split("/").at(-1);
      const value = response(
        contract,
        name,
        Number(url.searchParams.get("count")),
        JSON.parse(body || "{}"),
      );
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(value));
      return;
    }
    const relative = url.pathname.includes("/assets/")
      ? url.pathname.slice(url.pathname.indexOf("/assets/") + 1)
      : "benchmarks/dashboard/index.html";
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep)) throw new Error("Invalid path");
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
    res.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(500);
    res.end("Benchmark error");
  }
});
const port = Number(process.env.BENCHMARK_PORT ?? 4180);
server.listen(port, "127.0.0.1", () =>
  console.log(`Dashboard ${version} benchmark on http://127.0.0.1:${port}`),
);
