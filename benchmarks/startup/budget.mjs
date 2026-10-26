import { readFileSync, statSync } from "node:fs";
import { assertNewOutputs, writeNewReport } from "./output.mjs";
import { resolve, dirname, basename } from "node:path";
import { get } from "node:http";
const version = process.env.STARTUP_VERSION ?? "baseline";
if (!["baseline", "optimized"].includes(version)) throw Error("Unknown build version.");
const output = process.env.STARTUP_OUTPUT ?? `docs/performance/startup-${version}-budgets.json`;
assertNewOutputs([output]);
const root = resolve(`dist/startup/${version}/production/public`),
  port = version === "baseline" ? 4190 : 4192;
const result = { version, routes: {} };
for (const route of ["/", "/dashboard"]) {
  const html = await new Promise((done, fail) =>
    get(`http://127.0.0.1:${port}${route}`, (response) => {
      let body = "";
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => done(body));
      response.on("error", fail);
    }).on("error", fail),
  );
  const assets = new Set(
    [...html.matchAll(/(?:href|src)="([^" ]+\.js)"/g)]
      .map((m) => m[1])
      .filter((x) => x.startsWith("/assets/")),
  );
  const visited = new Set();
  function walk(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(
      /\bimport\s*(?:\{[^}]*\}|[\w*$,\s]+)?\s*(?:from\s*)?["'](\.\/[^"']+\.js)["']/g,
    ))
      walk(resolve(dirname(file), m[1]));
  }
  for (const asset of assets) walk(resolve(root, `.${asset}`));
  if (!visited.size) throw Error("Missing document module assets");
  result.routes[route] = {
    uncompressedInitialJavascriptBytes: [...visited].reduce(
      (n, file) => n + statSync(file).size,
      0,
    ),
    assets: [...visited].map((file) => basename(file)).sort(),
  };
}
writeNewReport(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
